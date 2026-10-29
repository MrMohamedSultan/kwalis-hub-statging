-- =====================================================================
-- STAGING ONLY — restore the storage.objects access policies on the self-hosted
-- test server (kwalis.technomasr.com).
--
-- Why: the server was restored from a backup of the public schema only, so
-- storage.objects has RLS ON but none of the policies the app's migrations
-- create (the deploy pre-check printed 0 policies). Result: signed-in users can
-- not read or upload attachments (receipts, project documents, support files,
-- org documents, contract files outside the two policies 201 created).
--
-- What: re-creates, exactly as the latest repo migration defines them, every
-- policy on storage.objects (21 policies, generated from supabase/migrations;
-- the two contract-folder policies are left as db/pending/201 re-created them).
-- Nothing else changes: no table, bucket, file or other schema is touched.
-- Do NOT run this on the Lovable production database (it already has them).
--
-- Rollback: DROP POLICY IF EXISTS "<name>" ON storage.objects; for each name below.
-- =====================================================================
BEGIN;

-- from supabase/migrations/20260707093538_e4b243b4-2628-4606-a321-bd78ebb3d2df.sql
DROP POLICY IF EXISTS "support_att_owner_read" ON storage.objects;
CREATE POLICY "support_att_owner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- from supabase/migrations/20260707093538_e4b243b4-2628-4606-a321-bd78ebb3d2df.sql
DROP POLICY IF EXISTS "support_att_admin_read" ON storage.objects;
CREATE POLICY "support_att_admin_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_super_admin(auth.uid())
  );

-- from supabase/migrations/20260707093538_e4b243b4-2628-4606-a321-bd78ebb3d2df.sql
DROP POLICY IF EXISTS "support_att_owner_insert" ON storage.objects;
CREATE POLICY "support_att_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- from supabase/migrations/20260707093538_e4b243b4-2628-4606-a321-bd78ebb3d2df.sql
DROP POLICY IF EXISTS "support_att_owner_delete" ON storage.objects;
CREATE POLICY "support_att_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- from supabase/migrations/20260716130441_ac8e2ef6-5127-4a26-9d4e-3a6a6db99ded.sql
DROP POLICY IF EXISTS "project_docs_select" ON storage.objects;
CREATE POLICY "project_docs_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND public.can_access_project(auth.uid(), p.organization_id, p.id)
    )
  );

-- from supabase/migrations/20260716130441_ac8e2ef6-5127-4a26-9d4e-3a6a6db99ded.sql
DROP POLICY IF EXISTS "project_docs_insert" ON storage.objects;
CREATE POLICY "project_docs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND public.can_access_project(auth.uid(), p.organization_id, p.id)
    )
  );

-- from supabase/migrations/20260716130441_ac8e2ef6-5127-4a26-9d4e-3a6a6db99ded.sql
DROP POLICY IF EXISTS "project_docs_update" ON storage.objects;
CREATE POLICY "project_docs_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND public.can_access_project(auth.uid(), p.organization_id, p.id)
    )
  );

-- from supabase/migrations/20260716130441_ac8e2ef6-5127-4a26-9d4e-3a6a6db99ded.sql
DROP POLICY IF EXISTS "project_docs_delete" ON storage.objects;
CREATE POLICY "project_docs_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND public.can_access_project(auth.uid(), p.organization_id, p.id)
    )
  );

-- from supabase/migrations/20260716141126_bb36510e-f451-41c6-8eb6-24fd1982a920.sql
DROP POLICY IF EXISTS "Project members can upload project documents by project" ON storage.objects;
CREATE POLICY "Project members can upload project documents by project"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-documents'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_access_project(
    auth.uid(),
    NULL,
    ((storage.foldername(name))[1])::uuid
  )
);

-- from supabase/migrations/20260716141126_bb36510e-f451-41c6-8eb6-24fd1982a920.sql
DROP POLICY IF EXISTS "Project members can read project documents by project" ON storage.objects;
CREATE POLICY "Project members can read project documents by project"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-documents'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_access_project(
    auth.uid(),
    NULL,
    ((storage.foldername(name))[1])::uuid
  )
);

-- from supabase/migrations/20260722132616_4d089eda-e9b0-4259-96aa-b6e99b79c7f4.sql
DROP POLICY IF EXISTS "Contract read requires record access" ON storage.objects;
CREATE POLICY "Contract read requires record access"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'contracts'
  AND public.can_access_contract_path(auth.uid(), name)
);

-- from supabase/migrations/20260722132616_4d089eda-e9b0-4259-96aa-b6e99b79c7f4.sql
DROP POLICY IF EXISTS "Contract upload requires record access" ON storage.objects;
CREATE POLICY "Contract upload requires record access"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'contracts'
  AND public.can_access_contract_path(auth.uid(), name)
);

-- from supabase/migrations/20260722132616_4d089eda-e9b0-4259-96aa-b6e99b79c7f4.sql
DROP POLICY IF EXISTS "Contract update requires record access" ON storage.objects;
CREATE POLICY "Contract update requires record access"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'contracts'
  AND public.can_access_contract_path(auth.uid(), name)
)
WITH CHECK (
  bucket_id = 'contracts'
  AND public.can_access_contract_path(auth.uid(), name)
);

-- from supabase/migrations/20260722132616_4d089eda-e9b0-4259-96aa-b6e99b79c7f4.sql
DROP POLICY IF EXISTS "Contract delete requires admin or record access" ON storage.objects;
CREATE POLICY "Contract delete requires admin or record access"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'contracts'
  AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.contracts_path_scope(name) s
      WHERE s.org_id IS NOT NULL AND public.is_org_admin(auth.uid(), s.org_id)
    )
    OR public.can_access_contract_path(auth.uid(), name)
  )
);

-- from supabase/migrations/20260729054412_ea9346b6-fe02-4dc4-8c8f-6a384f419e2e.sql
DROP POLICY IF EXISTS "receipts_insert_authenticated" ON storage.objects;
CREATE POLICY "receipts_insert_authenticated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'receipts' AND owner = auth.uid());

-- from supabase/migrations/20260729054412_ea9346b6-fe02-4dc4-8c8f-6a384f419e2e.sql
DROP POLICY IF EXISTS "receipts_update_owner_or_admin" ON storage.objects;
CREATE POLICY "receipts_update_owner_or_admin"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'receipts' AND (owner = auth.uid() OR public.is_super_admin(auth.uid())))
WITH CHECK (bucket_id = 'receipts' AND (owner = auth.uid() OR public.is_super_admin(auth.uid())));

-- from supabase/migrations/20260729054412_ea9346b6-fe02-4dc4-8c8f-6a384f419e2e.sql
DROP POLICY IF EXISTS "receipts_delete_owner_or_admin" ON storage.objects;
CREATE POLICY "receipts_delete_owner_or_admin"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'receipts' AND (owner = auth.uid() OR public.is_super_admin(auth.uid())));

-- from supabase/migrations/20260729110102_d4eb4406-448c-46c2-a261-2483330193f6.sql
DROP POLICY IF EXISTS "receipts_select_owner_or_admin" ON storage.objects;
CREATE POLICY "receipts_select_owner_or_admin"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts'
  AND (
    owner = auth.uid()
    OR (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_super_admin(auth.uid())
  )
);

-- from supabase/migrations/20260730094425_71225048-da67-437b-b092-8723d8249a51.sql
DROP POLICY IF EXISTS "org_documents_insert" ON storage.objects;
CREATE POLICY "org_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'org-documents' AND public.is_super_admin(auth.uid()));

-- from supabase/migrations/20260730094425_71225048-da67-437b-b092-8723d8249a51.sql
DROP POLICY IF EXISTS "org_documents_select" ON storage.objects;
CREATE POLICY "org_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'org-documents' AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.organization_documents d
        WHERE d.file_url = storage.objects.name
          AND public.is_org_admin(auth.uid(), d.organization_id)
      )
    )
  );

-- from supabase/migrations/20260730094425_71225048-da67-437b-b092-8723d8249a51.sql
DROP POLICY IF EXISTS "org_documents_delete" ON storage.objects;
CREATE POLICY "org_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'org-documents' AND public.is_super_admin(auth.uid()));

COMMIT;
SELECT count(*) AS storage_policies FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
