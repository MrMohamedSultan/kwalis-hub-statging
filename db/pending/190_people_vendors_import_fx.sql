-- =====================================================================
-- 190 — Person profiles, vendor profile → invoice, budget import checks,
--       dated exchange rates with a source.
--
-- Spec items E01 / N09 / E05 / E13 / D01 / D03 (client review 2026-10-27).
--
-- E01  Today every public.people row is one CONTRACT and the name is free
--      text, so the same person appears twice with two spellings and real
--      multiple contracts look like several people (decision 18: multiple
--      contracts per person are real). New table public.persons (one per
--      person per organization) and people.person_id (contract → person).
--
--      Which field lives where:
--        person (master, kept in sync on every contract of that person):
--          full_name, id_type, id_number, nationality, mother_saudi,
--          related_party, phone_number, email
--        person = default only (copied into a NEW contract when the contract
--        leaves it empty; each contract keeps its own value afterwards,
--        because a contract can be paid to another account or fall in
--        another tax year):
--          bank, bank_country, iban, swift_code, tax_residency
--        contract only: everything else (dates, rates, WHT rate/treatment,
--        position, character, budget line, approval …).
--
--      Sync rules (triggers, so every write path follows them):
--        · contract saved with person_id → identity typed on the contract is
--          pushed to the profile and from there to the person's other
--          contracts; fields the contract leaves empty are filled from the
--          profile.
--        · contract saved without person_id → linked to the profile with the
--          SAME ID number in the organization (exact match only — never by
--          name), otherwise a profile is created from the contract.
--        · contract moved to another profile (merge / re-link) → it takes
--          that profile's identity.
--        · profile edited → its contracts follow.
--        · two profiles can never share an ID number in one organization.
--      persons_backfill(org, apply) links EXISTING contracts by exact ID
--      number only (dry run by default) and never rewrites a contract field:
--      only people.person_id (new column) is filled. Name look-alikes are
--      listed in the app (People profiles → Possible duplicates) for the
--      owner to merge with persons_merge(keep, drop).
--
-- E05  vendors get tax_residency, related_party, related_party_note (CR,
--      VAT, country = company_nationality, bank country and bank name are
--      already there). invoices get vendor_id plus a snapshot of the vendor
--      profile at entry (vendor_cr_no, vendor_vat_no, vendor_country,
--      vendor_tax_residency, vendor_bank_country, vendor_bank_name). A new
--      invoice is linked to its vendor (by id, else by exact name in the
--      organization) and inherits the profile values it does not carry, and
--      the related-party flag. Backfill: invoices.vendor_id by exact name
--      only (new column).
--
-- E13 / D01  import_budget_validate (150) redefined, same signature; copied
--      from 150 with three changes, marked "190:" —
--        · spaces inside descriptions / names collapsed (not only trimmed),
--          so "Head  Writer " and "Head Writer" are the same line and the
--          duplicate check sees them as one;
--        · Header ≤ Main: when both codes are plain numbers and the header
--          is greater than the main code, they were entered the wrong way
--          round — the two are swapped and the row gets a warning; a main
--          code outside a header range ("5000-5400") is a warning;
--        · the header code is returned trimmed of spaces as well.
--      The app now cleans the file the same way (trim, round to 2 decimals,
--      duplicates warned and skipped) and runs import_budget_preview before
--      writing.
--
-- D03  public.project_currency_rates: a dated rate per project and currency
--      (SAR per 1 unit) with its source (SAMA, bank, project, manual) and a
--      reference. project_rate_on(project, currency, date) returns the rate
--      in force on a date. invoices and purchase_orders keep the source and
--      date of the rate they used (fx_rate_source, fx_rate_date). Stored
--      amounts are unchanged (already in SAR, original kept next to them).
--
-- ADDITIVE and idempotent: new tables, nullable columns, new functions and
-- triggers; one existing function redefined (import_budget_validate).
-- No existing client value is rewritten; backfills fill new columns only.
--
-- SECURITY: two new tenant tables with RLS (persons: see secfix #4 below;
-- project_currency_rates: project access, writes by company admins or the
-- Funding editors); SECURITY DEFINER trigger functions check that a person /
-- vendor belongs to the contract's / invoice's organization. Apply only
-- after owner approval (SECURITY.md).
--
-- Owner steps after applying:
--   1. backup;
--   2. per organization: SELECT * FROM persons_backfill('<org id>');        -- dry run, review
--                        SELECT * FROM persons_backfill('<org id>', true);  -- link
--   3. review "Possible duplicates" in Crew/Cast → People profiles and merge.
--
-- Security review fixes (secfix, before first apply):
--   #4  persons rows are readable / editable only by org admins and by users
--       who can open at least one of the person's contracts
--       (can_read_person); changing a person's identity (pushed to all their
--       contracts) needs access to EVERY contract of that person or an org
--       admin (can_edit_person_identity, checked in persons_propagate); a new
--       contract is never linked to a profile the user cannot read (by ID
--       number or by a person_id sent by the client).
--       Note: bank / IBAN stay on persons as defaults; they are now visible
--       only to users who can open one of that person's contracts.
--   #9  invoices_inherit_vendor takes the organization from the invoice's
--       project (refused when they differ).
--   #10 a contract that existed before this file is linked only by
--       persons_backfill — a plain edit never links it or rewrites it.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS trg_people_link_person ON public.people;
--   DROP TRIGGER IF EXISTS trg_people_push_person ON public.people;
--   DROP TRIGGER IF EXISTS trg_persons_propagate ON public.persons;
--   DROP TRIGGER IF EXISTS trg_invoices_inherit_vendor ON public.invoices;
--   DROP FUNCTION IF EXISTS public.people_link_person(), public.people_push_person(),
--     public.persons_propagate(), public.persons_backfill(uuid, boolean),
--     public.persons_merge(uuid, uuid), public.person_id_key(text),
--     public.invoices_inherit_vendor(), public.project_rate_on(uuid, text, date),
--     public.project_currency_rates_stamp_org(), public.can_edit_person_identity(uuid),
--     public.can_read_person(uuid);
--   ALTER TABLE public.people DROP COLUMN IF EXISTS person_id;
--   DROP TABLE IF EXISTS public.persons;
--   DROP TABLE IF EXISTS public.project_currency_rates;
--   re-run db/pending/150 to restore its import_budget_validate;
--   the other added columns can stay (nullable, unused) or be dropped.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. E01 — person profiles
-- ---------------------------------------------------------------------
-- ID number as compared: letters and digits only, upper case; NULL when empty.
CREATE OR REPLACE FUNCTION public.person_id_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

CREATE TABLE IF NOT EXISTS public.persons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name          text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  id_type            text CHECK (id_type IS NULL OR id_type IN ('national_id', 'iqama', 'passport')),
  id_number          text CHECK (id_number IS NULL OR length(id_number) <= 40),
  id_number_key      text GENERATED ALWAYS AS (public.person_id_key(id_number)) STORED,
  nationality        text CHECK (nationality IS NULL OR length(nationality) <= 100),
  mother_saudi       boolean,
  related_party      boolean,
  related_party_note text CHECK (related_party_note IS NULL OR length(related_party_note) <= 1000),
  tax_residency      text CHECK (tax_residency IS NULL OR tax_residency IN ('resident', 'non_resident')),
  phone_number       text CHECK (phone_number IS NULL OR length(phone_number) <= 40),
  email              text CHECK (email IS NULL OR length(email) <= 255),
  bank               text CHECK (bank IS NULL OR length(bank) <= 200),
  bank_country       text CHECK (bank_country IS NULL OR length(bank_country) <= 100),
  iban               text CHECK (iban IS NULL OR length(iban) <= 64),
  swift_code         text CHECK (swift_code IS NULL OR length(swift_code) <= 20),
  notes              text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.persons IS
  'One profile per person per organization; public.people rows are that person''s contracts (people.person_id). db/pending/190.';

CREATE UNIQUE INDEX IF NOT EXISTS persons_org_id_number_key
  ON public.persons (organization_id, id_number_key) WHERE id_number_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS persons_org_name_idx ON public.persons (organization_id, lower(full_name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.persons TO authenticated;
GRANT ALL ON public.persons TO service_role;
ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS persons_delete ON public.persons;
CREATE POLICY persons_delete ON public.persons FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS trg_stamp_audit_persons ON public.persons;
CREATE TRIGGER trg_stamp_audit_persons BEFORE INSERT OR UPDATE ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.stamp_audit_fields();
DROP TRIGGER IF EXISTS trg_audit_history_persons ON public.persons;
CREATE TRIGGER trg_audit_history_persons AFTER INSERT OR DELETE OR UPDATE ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.persons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS people_person_id_idx ON public.people (person_id);
COMMENT ON COLUMN public.people.person_id IS
  'The person this contract belongs to (public.persons). One person, many contracts. db/pending/190.';

-- secfix #4: a profile holds ID number, IBAN, bank, phone and e-mail and is
-- shared by the person's contracts, which are project-scoped. It is readable
-- (and editable) only by organization admins and by users who can open at
-- least one of the person's contracts (or who created a profile that has no
-- contract yet). Changing the identity of a person (pushed to all of their
-- contracts) additionally needs access to EVERY contract of that person —
-- see persons_propagate.
CREATE OR REPLACE FUNCTION public.can_read_person(_person uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL OR EXISTS (
    SELECT 1 FROM public.persons ps
     WHERE ps.id = _person
       AND (public.is_super_admin(auth.uid())
            OR public.is_org_admin(auth.uid(), ps.organization_id)
            OR EXISTS (SELECT 1 FROM public.people pe
                        WHERE pe.person_id = ps.id AND pe.organization_id = ps.organization_id
                          AND public.can_access_project(auth.uid(), pe.organization_id, pe.project_id))
            OR (ps.created_by = auth.uid()
                AND NOT EXISTS (SELECT 1 FROM public.people pe WHERE pe.person_id = ps.id))))
$$;
CREATE OR REPLACE FUNCTION public.can_edit_person_identity(_person uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL OR EXISTS (
    SELECT 1 FROM public.persons ps
     WHERE ps.id = _person
       AND (public.is_super_admin(auth.uid())
            OR public.is_org_admin(auth.uid(), ps.organization_id)
            OR (public.can_read_person(ps.id)
                AND NOT EXISTS (SELECT 1 FROM public.people pe
                                 WHERE pe.person_id = ps.id
                                   AND NOT (pe.organization_id = ps.organization_id
                                            AND public.can_access_project(auth.uid(), pe.organization_id, pe.project_id))))))
$$;
REVOKE ALL ON FUNCTION public.can_read_person(uuid), public.can_edit_person_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_person(uuid), public.can_edit_person_identity(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS persons_select ON public.persons;
CREATE POLICY persons_select ON public.persons FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id) AND public.can_read_person(id)
         OR public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS persons_insert ON public.persons;
CREATE POLICY persons_insert ON public.persons FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS persons_update ON public.persons;
CREATE POLICY persons_update ON public.persons FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (public.is_org_member(auth.uid(), organization_id) AND public.can_read_person(id)))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));

-- BEFORE: link / create the profile, check the tenant, fill what the contract leaves empty.
CREATE OR REPLACE FUNCTION public.people_link_person()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        public.persons%ROWTYPE;
  v_key    text := public.person_id_key(NEW.id_number);
  v_relink boolean;
BEGIN
  -- a change that comes FROM the profile (propagation, backfill, merge) is taken as is
  IF current_setting('kwalis.person_sync', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  -- unlinked on purpose (or its profile was deleted): leave it unlinked
  IF TG_OP = 'UPDATE' AND OLD.person_id IS NOT NULL AND NEW.person_id IS NULL THEN RETURN NEW; END IF;

  -- secfix #10: a contract that existed before this file (unlinked) is linked
  -- only by persons_backfill (dry run, reviewed) — a plain edit never links it
  -- and so never rewrites its identity from another contract's profile.
  IF TG_OP = 'UPDATE' AND OLD.person_id IS NULL AND NEW.person_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.person_id IS NULL THEN
    -- exact ID number only — never by name
    IF v_key IS NOT NULL THEN
      SELECT * INTO p FROM public.persons
       WHERE organization_id = NEW.organization_id AND id_number_key = v_key;
      -- secfix #4: a profile the caller cannot read (all of its contracts are
      -- in other projects) is not linked — linking would hand over its bank /
      -- IBAN / phone. The contract stays unlinked for an org admin to link
      -- (persons_backfill / the People profiles screen).
      IF p.id IS NOT NULL AND NOT public.can_read_person(p.id) THEN
        RETURN NEW;
      END IF;
    END IF;
    IF p.id IS NULL THEN
      INSERT INTO public.persons (organization_id, full_name, id_type, id_number, nationality,
                                  mother_saudi, related_party, tax_residency, phone_number, email,
                                  bank, bank_country, iban, swift_code, created_by)
      VALUES (NEW.organization_id, left(COALESCE(NULLIF(btrim(NEW.full_name), ''), 'Unnamed'), 200),
              NEW.id_type, NULLIF(btrim(NEW.id_number), ''), NULLIF(btrim(NEW.nationality), ''),
              NEW.mother_saudi, NEW.related_party, NEW.tax_residency,
              NULLIF(btrim(NEW.phone_number), ''), NULLIF(btrim(NEW.email), ''),
              NULLIF(btrim(NEW.bank), ''), NULLIF(btrim(NEW.bank_country), ''),
              NULLIF(btrim(NEW.iban), ''), NULLIF(btrim(NEW.swift_code), ''), auth.uid())
      RETURNING * INTO p;
      NEW.person_id := p.id;
      RETURN NEW;
    END IF;
    NEW.person_id := p.id;
    v_relink := true;               -- matched by ID: the profile is the reference
  ELSE
    SELECT * INTO p FROM public.persons WHERE id = NEW.person_id;
    IF NOT FOUND OR p.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'This person profile belongs to another organization'
        USING ERRCODE = '42501';
    END IF;
    v_relink := TG_OP = 'UPDATE' AND OLD.person_id IS DISTINCT FROM NEW.person_id;
    -- secfix #4: picking a profile needs read access to it
    IF (TG_OP = 'INSERT' OR v_relink) AND NOT public.can_read_person(p.id) THEN
      RAISE EXCEPTION 'This person profile belongs to another organization'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_relink THEN
    -- moved to (or matched with) a profile: take its identity
    NEW.full_name    := COALESCE(NULLIF(btrim(p.full_name), ''), NEW.full_name);
    NEW.id_type      := COALESCE(p.id_type, NEW.id_type);
    NEW.id_number    := COALESCE(p.id_number, NEW.id_number);
    NEW.nationality  := COALESCE(p.nationality, NEW.nationality);
    NEW.mother_saudi := COALESCE(p.mother_saudi, NEW.mother_saudi);
    NEW.related_party := COALESCE(p.related_party, NEW.related_party);
    NEW.phone_number := COALESCE(p.phone_number, NEW.phone_number);
    NEW.email        := COALESCE(p.email, NEW.email);
  ELSIF TG_OP = 'UPDATE' THEN
    -- same profile: what the user changed on the contract wins (pushed after
    -- the write); what they did not touch follows the profile
    IF NEW.full_name    IS NOT DISTINCT FROM OLD.full_name    THEN NEW.full_name    := COALESCE(NULLIF(btrim(p.full_name), ''), NEW.full_name); END IF;
    IF NEW.id_type      IS NOT DISTINCT FROM OLD.id_type      THEN NEW.id_type      := COALESCE(p.id_type, NEW.id_type); END IF;
    IF NEW.id_number    IS NOT DISTINCT FROM OLD.id_number    THEN NEW.id_number    := COALESCE(p.id_number, NEW.id_number); END IF;
    IF NEW.nationality  IS NOT DISTINCT FROM OLD.nationality  THEN NEW.nationality  := COALESCE(p.nationality, NEW.nationality); END IF;
    IF NEW.mother_saudi IS NOT DISTINCT FROM OLD.mother_saudi THEN NEW.mother_saudi := COALESCE(p.mother_saudi, NEW.mother_saudi); END IF;
    IF NEW.related_party IS NOT DISTINCT FROM OLD.related_party THEN NEW.related_party := COALESCE(p.related_party, NEW.related_party); END IF;
    IF NEW.phone_number IS NOT DISTINCT FROM OLD.phone_number THEN NEW.phone_number := COALESCE(p.phone_number, NEW.phone_number); END IF;
    IF NEW.email        IS NOT DISTINCT FROM OLD.email        THEN NEW.email        := COALESCE(p.email, NEW.email); END IF;
  ELSE
    -- new contract for a chosen profile: empty identity fields come from the profile
    NEW.full_name    := COALESCE(NULLIF(btrim(NEW.full_name), ''), p.full_name);
    NEW.id_type      := COALESCE(NEW.id_type, p.id_type);
    NEW.id_number    := COALESCE(NULLIF(btrim(NEW.id_number), ''), p.id_number);
    NEW.nationality  := COALESCE(NULLIF(btrim(NEW.nationality), ''), p.nationality);
    NEW.mother_saudi := COALESCE(NEW.mother_saudi, p.mother_saudi);
    NEW.related_party := COALESCE(NEW.related_party, p.related_party);
    NEW.phone_number := COALESCE(NULLIF(btrim(NEW.phone_number), ''), p.phone_number);
    NEW.email        := COALESCE(NULLIF(btrim(NEW.email), ''), p.email);
  END IF;

  -- defaults for a new contract (or one newly linked) — never overwrite a value
  IF TG_OP = 'INSERT' OR v_relink THEN
    NEW.bank          := COALESCE(NULLIF(btrim(NEW.bank), ''), p.bank, NEW.bank);
    NEW.bank_country  := COALESCE(NULLIF(btrim(NEW.bank_country), ''), p.bank_country, NEW.bank_country);
    NEW.iban          := COALESCE(NULLIF(btrim(NEW.iban), ''), p.iban, NEW.iban);
    NEW.swift_code    := COALESCE(NULLIF(btrim(NEW.swift_code), ''), p.swift_code);
    NEW.tax_residency := COALESCE(NEW.tax_residency, p.tax_residency);
  END IF;
  RETURN NEW;
END $$;

-- AFTER: identity typed on the contract → profile (→ the person's other contracts)
CREATE OR REPLACE FUNCTION public.people_push_person()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.persons%ROWTYPE;
  v_other text;
BEGIN
  IF current_setting('kwalis.person_sync', true) = 'on' OR NEW.person_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO p FROM public.persons WHERE id = NEW.person_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (NULLIF(btrim(NEW.full_name), '') IS NOT NULL AND btrim(NEW.full_name) IS DISTINCT FROM p.full_name)
     OR (NEW.id_type IS NOT NULL AND NEW.id_type IS DISTINCT FROM p.id_type)
     OR (NULLIF(btrim(NEW.id_number), '') IS NOT NULL AND btrim(NEW.id_number) IS DISTINCT FROM p.id_number)
     OR (NULLIF(btrim(NEW.nationality), '') IS NOT NULL AND btrim(NEW.nationality) IS DISTINCT FROM p.nationality)
     OR (NEW.mother_saudi IS NOT NULL AND NEW.mother_saudi IS DISTINCT FROM p.mother_saudi)
     OR (NEW.related_party IS NOT NULL AND NEW.related_party IS DISTINCT FROM p.related_party)
     OR (NULLIF(btrim(NEW.phone_number), '') IS NOT NULL AND btrim(NEW.phone_number) IS DISTINCT FROM p.phone_number)
     OR (NULLIF(btrim(NEW.email), '') IS NOT NULL AND btrim(NEW.email) IS DISTINCT FROM p.email) THEN
    -- the same ID number on another profile is refused with a readable message
    IF public.person_id_key(NEW.id_number) IS NOT NULL THEN
      SELECT o.full_name INTO v_other FROM public.persons o
       WHERE o.organization_id = p.organization_id AND o.id <> p.id
         AND o.id_number_key = public.person_id_key(NEW.id_number);
      IF v_other IS NOT NULL THEN
        RAISE EXCEPTION 'ID number % is already on the profile of %', btrim(NEW.id_number), v_other
          USING ERRCODE = '23505',
                HINT = 'Pick that person in the contract form instead of creating a new profile.';
      END IF;
    END IF;
    PERFORM set_config('kwalis.person_sync_source', NEW.id::text, true);
    UPDATE public.persons SET
      full_name     = COALESCE(left(NULLIF(btrim(NEW.full_name), ''), 200), full_name),
      id_type       = COALESCE(NEW.id_type, id_type),
      id_number     = COALESCE(NULLIF(btrim(NEW.id_number), ''), id_number),
      nationality   = COALESCE(NULLIF(btrim(NEW.nationality), ''), nationality),
      mother_saudi  = COALESCE(NEW.mother_saudi, mother_saudi),
      related_party = COALESCE(NEW.related_party, related_party),
      phone_number  = COALESCE(NULLIF(btrim(NEW.phone_number), ''), phone_number),
      email         = COALESCE(NULLIF(btrim(NEW.email), ''), email)
    WHERE id = p.id;
    PERFORM set_config('kwalis.person_sync_source', '', true);
  END IF;
  RETURN NULL;
END $$;

-- profile changed → every contract of that person follows (except the one that pushed it)
CREATE OR REPLACE FUNCTION public.persons_propagate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src text := NULLIF(current_setting('kwalis.person_sync_source', true), '');
BEGIN
  IF NEW.full_name IS NOT DISTINCT FROM OLD.full_name AND NEW.id_type IS NOT DISTINCT FROM OLD.id_type
     AND NEW.id_number IS NOT DISTINCT FROM OLD.id_number AND NEW.nationality IS NOT DISTINCT FROM OLD.nationality
     AND NEW.mother_saudi IS NOT DISTINCT FROM OLD.mother_saudi AND NEW.related_party IS NOT DISTINCT FROM OLD.related_party
     AND NEW.phone_number IS NOT DISTINCT FROM OLD.phone_number AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NULL;
  END IF;
  -- secfix #4: the identity reaches every contract of the person, so only
  -- someone who can open all of them (or an org admin) may change it
  IF NOT public.can_edit_person_identity(NEW.id) THEN
    RAISE EXCEPTION 'This person also has contracts in projects you cannot open — ask an organization admin to change their name, ID or contact details'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('kwalis.person_sync', 'on', true);
  UPDATE public.people pe SET
    full_name     = NEW.full_name,
    id_type       = COALESCE(NEW.id_type, pe.id_type),
    id_number     = COALESCE(NEW.id_number, pe.id_number),
    nationality   = COALESCE(NEW.nationality, pe.nationality),
    mother_saudi  = COALESCE(NEW.mother_saudi, pe.mother_saudi),
    related_party = COALESCE(NEW.related_party, pe.related_party),
    phone_number  = COALESCE(NEW.phone_number, pe.phone_number),
    email         = COALESCE(NEW.email, pe.email)
  WHERE pe.person_id = NEW.id
    AND (v_src IS NULL OR pe.id::text <> v_src)
    AND (pe.full_name IS DISTINCT FROM NEW.full_name
         OR pe.id_type IS DISTINCT FROM COALESCE(NEW.id_type, pe.id_type)
         OR pe.id_number IS DISTINCT FROM COALESCE(NEW.id_number, pe.id_number)
         OR pe.nationality IS DISTINCT FROM COALESCE(NEW.nationality, pe.nationality)
         OR pe.mother_saudi IS DISTINCT FROM COALESCE(NEW.mother_saudi, pe.mother_saudi)
         OR pe.related_party IS DISTINCT FROM COALESCE(NEW.related_party, pe.related_party)
         OR pe.phone_number IS DISTINCT FROM COALESCE(NEW.phone_number, pe.phone_number)
         OR pe.email IS DISTINCT FROM COALESCE(NEW.email, pe.email));
  PERFORM set_config('kwalis.person_sync', 'off', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_people_link_person ON public.people;
CREATE TRIGGER trg_people_link_person BEFORE INSERT OR UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.people_link_person();
DROP TRIGGER IF EXISTS trg_people_push_person ON public.people;
CREATE TRIGGER trg_people_push_person AFTER INSERT OR UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.people_push_person();
DROP TRIGGER IF EXISTS trg_persons_propagate ON public.persons;
CREATE TRIGGER trg_persons_propagate AFTER UPDATE ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.persons_propagate();

-- Link existing contracts by exact ID number. Dry run unless p_apply.
-- Contract fields are never rewritten: only people.person_id is filled.
CREATE OR REPLACE FUNCTION public.persons_backfill(p_org uuid, p_apply boolean DEFAULT false)
RETURNS TABLE (contract_id uuid, project_id uuid, full_name text, id_number text,
               person_id uuid, action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      record;
  v_key  text;
  v_pid  uuid;
  v_seen jsonb := '{}'::jsonb;   -- id key → person id (or 'new' in a dry run)
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), p_org)) THEN
    RAISE EXCEPTION 'persons_backfill: organization admins only' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('kwalis.person_sync', 'on', true);
  FOR r IN SELECT pe.* FROM public.people pe
            WHERE pe.organization_id = p_org AND pe.person_id IS NULL
            ORDER BY pe.created_at, pe.id LOOP
    v_key := public.person_id_key(r.id_number);
    v_pid := NULL;
    action := NULL;
    IF v_key IS NOT NULL THEN
      SELECT ps.id INTO v_pid FROM public.persons ps WHERE ps.organization_id = p_org AND ps.id_number_key = v_key;
      IF v_pid IS NOT NULL THEN
        action := 'linked_by_id';
      ELSIF v_seen ? v_key THEN
        action := 'linked_by_id';
        v_pid := NULLIF(v_seen->>v_key, 'new')::uuid;
      END IF;
    END IF;
    IF action IS NULL THEN
      action := CASE WHEN v_key IS NULL THEN 'created_no_id' ELSE 'created' END;
      IF p_apply THEN
        INSERT INTO public.persons (organization_id, full_name, id_type, id_number, nationality, mother_saudi,
                                    related_party, tax_residency, phone_number, email, bank, bank_country, iban, swift_code)
        VALUES (p_org, left(COALESCE(NULLIF(btrim(r.full_name), ''), 'Unnamed'), 200), r.id_type,
                NULLIF(btrim(r.id_number), ''), NULLIF(btrim(r.nationality), ''), r.mother_saudi, r.related_party,
                r.tax_residency, NULLIF(btrim(r.phone_number), ''), NULLIF(btrim(r.email), ''),
                NULLIF(btrim(r.bank), ''), NULLIF(btrim(r.bank_country), ''), NULLIF(btrim(r.iban), ''),
                NULLIF(btrim(r.swift_code), ''))
        RETURNING id INTO v_pid;
      END IF;
      IF v_key IS NOT NULL THEN v_seen := v_seen || jsonb_build_object(v_key, COALESCE(v_pid::text, 'new')); END IF;
    END IF;
    IF p_apply THEN
      UPDATE public.people SET person_id = v_pid WHERE id = r.id;
    END IF;
    contract_id := r.id; project_id := r.project_id; full_name := r.full_name;
    id_number := r.id_number; person_id := v_pid;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('kwalis.person_sync', 'off', true);
END $$;

-- Merge two profiles of the same person (owner decision after reviewing look-alikes).
CREATE OR REPLACE FUNCTION public.persons_merge(p_keep uuid, p_drop uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.persons%ROWTYPE;
  d public.persons%ROWTYPE;
  v_ids uuid[];
  n integer;
BEGIN
  SELECT * INTO k FROM public.persons WHERE id = p_keep;
  SELECT * INTO d FROM public.persons WHERE id = p_drop;
  IF k.id IS NULL OR d.id IS NULL OR k.id = d.id THEN
    RAISE EXCEPTION 'persons_merge: two different existing profiles are needed' USING ERRCODE = '22023';
  END IF;
  IF k.organization_id <> d.organization_id THEN
    RAISE EXCEPTION 'persons_merge: profiles belong to different organizations' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), k.organization_id)) THEN
    RAISE EXCEPTION 'persons_merge: organization admins only' USING ERRCODE = '42501';
  END IF;
  IF k.id_number_key IS NOT NULL AND d.id_number_key IS NOT NULL AND k.id_number_key <> d.id_number_key THEN
    RAISE EXCEPTION 'persons_merge: the two profiles have different ID numbers (% / %) — they are not the same person',
      k.id_number, d.id_number USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(pe.id) INTO v_ids FROM public.people pe WHERE pe.person_id = d.id;
  -- drop the duplicate profile first (its contracts' link is cleared as is, no re-linking)
  PERFORM set_config('kwalis.person_sync', 'on', true);
  DELETE FROM public.persons WHERE id = d.id;
  PERFORM set_config('kwalis.person_sync', 'off', true);
  UPDATE public.persons SET                               -- keep what the dropped profile knew
    id_type = COALESCE(id_type, d.id_type), id_number = COALESCE(id_number, d.id_number),
    nationality = COALESCE(nationality, d.nationality), mother_saudi = COALESCE(mother_saudi, d.mother_saudi),
    related_party = COALESCE(related_party, d.related_party), tax_residency = COALESCE(tax_residency, d.tax_residency),
    phone_number = COALESCE(phone_number, d.phone_number), email = COALESCE(email, d.email),
    bank = COALESCE(bank, d.bank), bank_country = COALESCE(bank_country, d.bank_country),
    iban = COALESCE(iban, d.iban), swift_code = COALESCE(swift_code, d.swift_code)
  WHERE id = k.id;
  -- the dropped profile's contracts move to the kept one and take its identity
  UPDATE public.people SET person_id = k.id WHERE id = ANY (COALESCE(v_ids, '{}'::uuid[]));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.persons_backfill(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.persons_merge(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.people_link_person() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.people_push_person() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.persons_propagate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persons_backfill(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persons_merge(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.person_id_key(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. E05 — vendor profile → invoice
-- ---------------------------------------------------------------------
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS tax_residency      text,
  ADD COLUMN IF NOT EXISTS related_party      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_party_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_tax_residency_check'
                 AND conrelid = 'public.vendors'::regclass) THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_tax_residency_check
      CHECK (tax_residency IS NULL OR tax_residency IN ('resident', 'non_resident'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_related_party_note_len'
                 AND conrelid = 'public.vendors'::regclass) THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_related_party_note_len
      CHECK (related_party_note IS NULL OR length(related_party_note) <= 1000);
  END IF;
END $$;
COMMENT ON COLUMN public.vendors.tax_residency IS
  'resident | non_resident (KSA tax residency). NULL = not confirmed; the app suggests non_resident when the company and its bank are outside KSA.';
COMMENT ON COLUMN public.vendors.related_party IS 'Related party (Film Commission disclosure) — inherited by new invoices.';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vendor_id            uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_cr_no         text,
  ADD COLUMN IF NOT EXISTS vendor_vat_no        text,
  ADD COLUMN IF NOT EXISTS vendor_country       text,
  ADD COLUMN IF NOT EXISTS vendor_tax_residency text,
  ADD COLUMN IF NOT EXISTS vendor_bank_country  text,
  ADD COLUMN IF NOT EXISTS vendor_bank_name     text;
CREATE INDEX IF NOT EXISTS invoices_vendor_id_idx ON public.invoices (vendor_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_vendor_tax_residency_check'
                 AND conrelid = 'public.invoices'::regclass) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_vendor_tax_residency_check
      CHECK (vendor_tax_residency IS NULL OR vendor_tax_residency IN ('resident', 'non_resident'));
  END IF;
END $$;
COMMENT ON COLUMN public.invoices.vendor_id IS 'Vendor profile the invoice was raised by; the vendor_* columns are its values at entry. db/pending/190.';

CREATE OR REPLACE FUNCTION public.invoices_inherit_vendor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v     public.vendors%ROWTYPE;
  v_org uuid := NEW.organization_id;
BEGIN
  -- secfix #9: the organization is the one of the invoice's project, never
  -- only what the caller sent (the insert policy does not tie the two)
  IF NEW.project_id IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.projects WHERE id = NEW.project_id;
    IF v_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'invoices: the project belongs to another organization' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.vendor_id IS NULL AND NULLIF(btrim(NEW.vendor_name), '') IS NOT NULL AND v_org IS NOT NULL THEN
    SELECT * INTO v FROM public.vendors
     WHERE organization_id = v_org AND lower(btrim(name)) = lower(btrim(NEW.vendor_name))
     ORDER BY created_at LIMIT 1;
    NEW.vendor_id := v.id;
  ELSIF NEW.vendor_id IS NOT NULL THEN
    SELECT * INTO v FROM public.vendors WHERE id = NEW.vendor_id;
    IF NOT FOUND OR v.organization_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'This vendor belongs to another organization' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v.id IS NULL THEN RETURN NEW; END IF;
  -- inherit only on entry or when the vendor changes; a later edit of the
  -- vendor profile never rewrites an existing invoice
  IF TG_OP = 'INSERT' OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
    NEW.vendor_name          := COALESCE(NULLIF(btrim(NEW.vendor_name), ''), v.name);
    NEW.vendor_cr_no         := COALESCE(NULLIF(btrim(NEW.vendor_cr_no), ''), NULLIF(btrim(v.cr_no), ''));
    NEW.vendor_vat_no        := COALESCE(NULLIF(btrim(NEW.vendor_vat_no), ''), NULLIF(btrim(v.vat_no), ''));
    NEW.vendor_country       := COALESCE(NULLIF(btrim(NEW.vendor_country), ''), NULLIF(btrim(v.company_nationality), ''));
    NEW.vendor_tax_residency := COALESCE(NEW.vendor_tax_residency, v.tax_residency);
    NEW.vendor_bank_country  := COALESCE(NULLIF(btrim(NEW.vendor_bank_country), ''), NULLIF(btrim(v.bank_country), ''));
    NEW.vendor_bank_name     := COALESCE(NULLIF(btrim(NEW.vendor_bank_name), ''), NULLIF(btrim(v.bank_name), ''));
    IF v.related_party AND NOT COALESCE(NEW.is_related_party, false) THEN
      NEW.is_related_party   := true;
      NEW.related_party_note := COALESCE(NULLIF(btrim(NEW.related_party_note), ''), v.related_party_note);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.invoices_inherit_vendor() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_invoices_inherit_vendor ON public.invoices;
CREATE TRIGGER trg_invoices_inherit_vendor BEFORE INSERT OR UPDATE OF vendor_id, vendor_name ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_inherit_vendor();

-- backfill the new link only (exact name in the organization); no other column touched
UPDATE public.invoices i SET vendor_id = v.id
  FROM public.vendors v
 WHERE i.vendor_id IS NULL
   AND v.organization_id = i.organization_id
   AND lower(btrim(v.name)) = lower(btrim(i.vendor_name))
   AND NULLIF(btrim(i.vendor_name), '') IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. D03 — dated exchange rates with a source
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_currency_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  base_currency   text NOT NULL DEFAULT 'SAR' CHECK (base_currency ~ '^[A-Z]{3}$'),
  rate_date       date NOT NULL,
  rate            numeric(14,6) NOT NULL CHECK (rate > 0),
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('sama', 'bank', 'project', 'manual')),
  source_ref      text CHECK (source_ref IS NULL OR length(source_ref) <= 300),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_currency_rates_not_base CHECK (currency <> base_currency),
  CONSTRAINT project_currency_rates_unique UNIQUE (project_id, currency, rate_date)
);
COMMENT ON TABLE public.project_currency_rates IS
  'Exchange rate per project, currency and date (base units per 1 unit of currency) with its source — e.g. the SAMA rate of a transaction date for Film Commission claims. db/pending/190.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_currency_rates TO authenticated;
GRANT ALL ON public.project_currency_rates TO service_role;
ALTER TABLE public.project_currency_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_currency_rates_select ON public.project_currency_rates;
CREATE POLICY project_currency_rates_select ON public.project_currency_rates FOR SELECT TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id));
DROP POLICY IF EXISTS project_currency_rates_insert ON public.project_currency_rates;
CREATE POLICY project_currency_rates_insert ON public.project_currency_rates FOR INSERT TO authenticated
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id)
              AND (public.is_company_admin_for_project(project_id) OR public.can_edit('funding')));
DROP POLICY IF EXISTS project_currency_rates_update ON public.project_currency_rates;
CREATE POLICY project_currency_rates_update ON public.project_currency_rates FOR UPDATE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id)
         AND (public.is_company_admin_for_project(project_id) OR public.can_edit('funding')))
  WITH CHECK (public.can_access_project(auth.uid(), organization_id, project_id)
              AND (public.is_company_admin_for_project(project_id) OR public.can_edit('funding')));
DROP POLICY IF EXISTS project_currency_rates_delete ON public.project_currency_rates;
CREATE POLICY project_currency_rates_delete ON public.project_currency_rates FOR DELETE TO authenticated
  USING (public.can_access_project(auth.uid(), organization_id, project_id)
         AND (public.is_company_admin_for_project(project_id) OR public.can_edit('funding')));

-- organization always the project's own (never trusted from the client)
CREATE OR REPLACE FUNCTION public.project_currency_rates_stamp_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT p.organization_id INTO NEW.organization_id FROM public.projects p WHERE p.id = NEW.project_id;
  NEW.currency := upper(btrim(NEW.currency));
  NEW.base_currency := upper(btrim(COALESCE(NEW.base_currency, 'SAR')));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.project_currency_rates_stamp_org() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_project_currency_rates_org ON public.project_currency_rates;
CREATE TRIGGER trg_project_currency_rates_org BEFORE INSERT OR UPDATE OF project_id, currency, base_currency
  ON public.project_currency_rates FOR EACH ROW EXECUTE FUNCTION public.project_currency_rates_stamp_org();
DROP TRIGGER IF EXISTS trg_stamp_audit_project_currency_rates ON public.project_currency_rates;
CREATE TRIGGER trg_stamp_audit_project_currency_rates BEFORE INSERT OR UPDATE ON public.project_currency_rates
  FOR EACH ROW EXECUTE FUNCTION public.stamp_audit_fields();
DROP TRIGGER IF EXISTS trg_audit_history_project_currency_rates ON public.project_currency_rates;
CREATE TRIGGER trg_audit_history_project_currency_rates AFTER INSERT OR DELETE OR UPDATE ON public.project_currency_rates
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_history();

-- Rate in force on a date: the latest rate dated on or before it. RLS applies.
CREATE OR REPLACE FUNCTION public.project_rate_on(p_project uuid, p_currency text, p_date date)
RETURNS TABLE (rate numeric, rate_date date, source text, source_ref text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT r.rate, r.rate_date, r.source, r.source_ref
    FROM public.project_currency_rates r
   WHERE r.project_id = p_project
     AND r.currency = upper(btrim(p_currency))
     AND r.rate_date <= COALESCE(p_date, current_date)
   ORDER BY r.rate_date DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.project_rate_on(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_rate_on(uuid, text, date) TO authenticated, service_role;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fx_rate_source text,
  ADD COLUMN IF NOT EXISTS fx_rate_date   date;
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS fx_rate_source text,
  ADD COLUMN IF NOT EXISTS fx_rate_date   date;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_fx_rate_source_check'
                 AND conrelid = 'public.invoices'::regclass) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_fx_rate_source_check
      CHECK (fx_rate_source IS NULL OR fx_rate_source IN ('sama', 'bank', 'project', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_fx_rate_source_check'
                 AND conrelid = 'public.purchase_orders'::regclass) THEN
    ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_fx_rate_source_check
      CHECK (fx_rate_source IS NULL OR fx_rate_source IN ('sama', 'bank', 'project', 'manual'));
  END IF;
END $$;
COMMENT ON COLUMN public.invoices.fx_rate_source IS 'Where the invoice FX rate came from: sama | bank | project | manual. db/pending/190.';
COMMENT ON COLUMN public.invoices.fx_rate_date IS 'Date of the FX rate used (the rate table entry date, or the invoice date for a manual rate).';

-- ---------------------------------------------------------------------
-- 4. E13 / D01 — import_budget_validate (copied from 150; "190:" marks the changes)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_budget_validate(p_project_id uuid, p_lines jsonb)
RETURNS TABLE (
  ord            integer,   -- position in the array (1-based)
  row_no         integer,   -- "row" given by the caller, else ord
  status         text,      -- ok | warning | error
  messages       text[],
  duplicate_of   integer,   -- row_no of the earlier identical row
  header_code    text,
  main_code      text,
  description    text,
  name           text,
  "group"        text,
  topsheet_code  text,
  amount         numeric,
  rate           numeric,
  x              numeric,
  unit           text,
  prep           numeric,
  shooting       numeric,
  wrap           numeric,
  currency       text,
  notes          text,
  excluded       boolean,
  line_total_sar numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org uuid; v_fx numeric;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'budget import: p_lines must be a JSON array of rows' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 20000 THEN
    RAISE EXCEPTION 'budget import: too many rows (% > 20000)', jsonb_array_length(p_lines) USING ERRCODE = '22023';
  END IF;
  SELECT p.organization_id, p.fx_rate INTO v_org, v_fx FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.can_access_project(auth.uid(), v_org, p_project_id) THEN
    RAISE EXCEPTION 'budget import: access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT e.ord::int AS ord, e.elem
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS e(elem, ord)
  ),
  parsed0 AS (
    SELECT r.ord,
           COALESCE(public.import_try_numeric(r.elem->>'row')::int, r.ord) AS row_no,
           jsonb_typeof(r.elem) = 'object'                       AS is_object,
           -- 190: spaces inside codes removed, inside texts collapsed
           NULLIF(regexp_replace(btrim(r.elem->>'header_code'), '\s+', '', 'g'), '') AS raw_header_code,
           NULLIF(regexp_replace(btrim(r.elem->>'main_code'), '\s+', '', 'g'), '')   AS raw_main_code,
           NULLIF(regexp_replace(btrim(r.elem->>'description'), '\s+', ' ', 'g'), '') AS description,
           NULLIF(regexp_replace(btrim(r.elem->>'name'), '\s+', ' ', 'g'), '')        AS name,
           NULLIF(btrim(r.elem->>'group'), '')                   AS grp,
           NULLIF(btrim(r.elem->>'topsheet_code'), '')           AS topsheet_code,
           NULLIF(btrim(r.elem->>'unit'), '')                    AS unit,
           upper(NULLIF(btrim(r.elem->>'currency'), ''))         AS currency,
           NULLIF(btrim(r.elem->>'notes'), '')                   AS notes,
           COALESCE(lower(r.elem->>'excluded') IN ('true', 't', '1', 'yes'), false) AS excluded,
           -- raw text of every numeric field, and its parsed value
           NULLIF(btrim(r.elem->>'amount'), '')   AS t_amount,   public.import_try_numeric(r.elem->>'amount')   AS amount,
           NULLIF(btrim(r.elem->>'rate'), '')     AS t_rate,     public.import_try_numeric(r.elem->>'rate')     AS rate,
           NULLIF(btrim(r.elem->>'x'), '')        AS t_x,        public.import_try_numeric(r.elem->>'x')        AS x,
           NULLIF(btrim(r.elem->>'prep'), '')     AS t_prep,     public.import_try_numeric(r.elem->>'prep')     AS prep,
           NULLIF(btrim(r.elem->>'shooting'), '') AS t_shooting, public.import_try_numeric(r.elem->>'shooting') AS shooting,
           NULLIF(btrim(r.elem->>'wrap'), '')     AS t_wrap,     public.import_try_numeric(r.elem->>'wrap')     AS wrap
    FROM raw r
  ),
  -- 190: Header ≤ Main. Two plain numbers the wrong way round are swapped.
  fixed AS (
    SELECT q.*,
           (q.raw_header_code ~ '^[0-9]+$' AND q.raw_main_code ~ '^[0-9]+(\.[0-9]+)?$'
            AND q.raw_header_code::numeric > q.raw_main_code::numeric) AS swapped,
           CASE WHEN q.raw_header_code ~ '^[0-9]+-[0-9]+$' AND q.raw_main_code ~ '^[0-9]+(\.[0-9]+)?$'
                     AND (q.raw_main_code::numeric < split_part(q.raw_header_code, '-', 1)::numeric
                          OR q.raw_main_code::numeric >= split_part(q.raw_header_code, '-', 2)::numeric + 100)
                THEN true ELSE false END AS out_of_range
    FROM parsed0 q
  ),
  parsed AS (
    SELECT f.*,
           CASE WHEN f.swapped THEN f.raw_main_code ELSE f.raw_header_code END AS header_code,
           CASE WHEN f.swapped THEN f.raw_header_code ELSE f.raw_main_code END AS main_code
    FROM fixed f
  ),
  master AS (
    SELECT mb.budget_code AS code,
           bool_or(COALESCE(mb.is_header, false)) AS is_header,
           min(mb.topsheet_code) AS topsheet_code
    FROM public.master_budget mb GROUP BY mb.budget_code
  ),
  -- identical rows: everything that defines the line is the same
  keyed AS (
    SELECT p.*,
           md5(concat_ws('|', p.header_code, p.main_code, lower(COALESCE(p.description, '')), lower(COALESCE(p.name, '')),
                         p.amount, p.rate, p.x, lower(COALESCE(p.unit, '')), p.prep, p.shooting, p.wrap,
                         COALESCE(p.currency, 'USD'), p.excluded)) AS k
    FROM parsed p
  ),
  dup AS (
    SELECT k.*, first_value(k.row_no) OVER (PARTITION BY k.k ORDER BY k.ord) AS first_row,
           row_number() OVER (PARTITION BY k.k ORDER BY k.ord) AS rn
    FROM keyed k
  ),
  checked AS (
    SELECT d.*, m.code IS NOT NULL AS in_master, COALESCE(m.is_header, false) AS code_is_header,
           m.topsheet_code AS master_topsheet,
           (ts.code IS NOT NULL) AS topsheet_known,
           array_remove(ARRAY[
             CASE WHEN NOT d.is_object THEN 'row is not an object' END,
             CASE WHEN d.main_code IS NULL THEN 'budget code is missing' END,
             CASE WHEN d.main_code IS NOT NULL AND d.main_code !~ '^[0-9A-Za-z._-]{1,32}$'
                    THEN 'budget code "' || left(d.main_code, 40) || '" has invalid characters' END,
             CASE WHEN d.description IS NULL THEN 'description is missing' END,
             CASE WHEN length(COALESCE(d.description, '')) > 500 THEN 'description is longer than 500 characters' END,
             CASE WHEN d.t_amount   IS NOT NULL AND d.amount   IS NULL THEN 'amount "'   || left(d.t_amount, 30)   || '" is not a number' END,
             CASE WHEN d.t_rate     IS NOT NULL AND d.rate     IS NULL THEN 'rate "'     || left(d.t_rate, 30)     || '" is not a number' END,
             CASE WHEN d.t_x        IS NOT NULL AND d.x        IS NULL THEN 'x "'        || left(d.t_x, 30)        || '" is not a number' END,
             CASE WHEN d.t_prep     IS NOT NULL AND d.prep     IS NULL THEN 'prep "'     || left(d.t_prep, 30)     || '" is not a number' END,
             CASE WHEN d.t_shooting IS NOT NULL AND d.shooting IS NULL THEN 'shooting "' || left(d.t_shooting, 30) || '" is not a number' END,
             CASE WHEN d.t_wrap     IS NOT NULL AND d.wrap     IS NULL THEN 'wrap "'     || left(d.t_wrap, 30)     || '" is not a number' END,
             CASE WHEN LEAST(COALESCE(d.amount, 0), COALESCE(d.rate, 0), COALESCE(d.x, 0), COALESCE(d.prep, 0),
                             COALESCE(d.shooting, 0), COALESCE(d.wrap, 0)) < 0 THEN 'negative numbers are not allowed' END,
             CASE WHEN d.rate IS NOT NULL AND d.rate <> round(d.rate, 2) THEN 'rate has more than 2 decimals' END,
             CASE WHEN d.currency IS NOT NULL AND d.currency NOT IN ('SAR', 'USD')
                    THEN 'currency "' || left(d.currency, 10) || '" is not SAR or USD' END,
             CASE WHEN COALESCE(m.is_header, false) THEN 'code ' || d.main_code || ' is a header account — use one of its detail codes' END
           ], NULL) AS errs,
           array_remove(ARRAY[
             CASE WHEN d.main_code IS NOT NULL AND m.code IS NULL
                    THEN 'code ' || d.main_code || ' is not in the master chart of accounts' END,
             CASE WHEN d.topsheet_code IS NOT NULL AND ts.code IS NULL
                    THEN 'top sheet account ' || d.topsheet_code || ' does not exist' END,
             CASE WHEN d.rn > 1 THEN 'identical to row ' || d.first_row || ' (duplicate)' END,
             CASE WHEN d.currency IS NULL THEN 'no currency given — treated as USD' END,
             CASE WHEN d.swapped THEN 'header code ' || d.raw_header_code || ' is after main code ' || d.raw_main_code
                                      || ' — the two were swapped (Header must be ≤ Main)' END,
             CASE WHEN d.out_of_range THEN 'main code ' || d.raw_main_code || ' is outside header range ' || d.raw_header_code END
           ], NULL) AS warns
    FROM dup d
    LEFT JOIN master m ON m.code = d.main_code
    LEFT JOIN public.budget_topsheet_accounts ts ON ts.code = d.topsheet_code
  )
  SELECT c.ord, c.row_no,
         CASE WHEN cardinality(c.errs) > 0 THEN 'error'
              WHEN cardinality(c.warns) > 0 THEN 'warning' ELSE 'ok' END,
         c.errs || c.warns,
         CASE WHEN c.rn > 1 THEN c.first_row END,
         c.header_code, c.main_code, c.description, c.name, c.grp,
         -- top sheet account: the one given when it exists, else the master chart's
         CASE WHEN c.topsheet_known THEN c.topsheet_code ELSE c.master_topsheet END,
         COALESCE(c.amount, 0), COALESCE(c.rate, 0), COALESCE(c.x, 0), c.unit,
         COALESCE(c.prep, 0), COALESCE(c.shooting, 0), COALESCE(c.wrap, 0),
         COALESCE(c.currency, 'USD'), c.notes, c.excluded,
         CASE WHEN cardinality(c.errs) = 0
                THEN public.budget_line_total_sar(COALESCE(c.amount, 0), COALESCE(c.rate, 0), COALESCE(c.x, 0),
                                                  COALESCE(c.prep, 0), COALESCE(c.shooting, 0), COALESCE(c.wrap, 0),
                                                  c.unit, COALESCE(c.currency, 'USD'), c.excluded, v_fx) END
  FROM checked c
  ORDER BY c.ord;
END;
$$;

REVOKE ALL ON FUNCTION public.import_budget_validate(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_budget_validate(uuid, jsonb) TO authenticated, service_role;
