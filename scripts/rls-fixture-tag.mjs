/**
 * Single source of truth for how RLS-regression fixtures are TAGGED and
 * how a purge is allowed to RECOGNISE them.
 * ---------------------------------------------------------------------
 * Rule: nothing is ever deleted because it "looks like" test data. A row is
 * only purgeable when it carries the dedicated fixture marker below in every
 * place the fixture writer is guaranteed to have put it. Real tenants and real
 * users can never carry this marker, so they can never be matched.
 */
import { randomUUID } from "node:crypto";

/** Dedicated marker. Never use this string in production data. */
export const FIXTURE_MARKER = "RLSFIXTURE";

/** Reserved, non-routable email domain used only by fixtures. */
export const FIXTURE_EMAIL_DOMAIN = "rlsfixture.example.test";

/** Hard protections — belt and braces on top of the marker requirement. */
export const PROTECTED_ORG_NAMES = ["Telfaz 11", "KwalisHUB Showcase"];
export const PROTECTED_EMAIL_DOMAINS = ["@telfaz11.com", "@kwalishub.com"];

/** rlsfixture-<epoch>-<rand> */
const RUN_TAG_RE = /^rlsfixture-\d{10,}-[a-z0-9]{4,12}$/i;

/** `[RLSFIXTURE] rlsfixture-<epoch>-<rand>-<suffix>` */
export const FIXTURE_ORG_NAME_RE =
  /^\[RLSFIXTURE\]\s+rlsfixture-\d{10,}-[a-z0-9]{4,12}-[a-z0-9-]+$/i;

/** `rlsfixture-<epoch>-<rand>-<label>@rlsfixture.example.test` */
export const FIXTURE_EMAIL_RE = new RegExp(
  `^rlsfixture-\\d{10,}-[a-z0-9]{4,12}-[a-z0-9-]+@${FIXTURE_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`,
  "i",
);

/** Slugs / codes are always prefixed with the run tag. */
export const FIXTURE_SLUG_RE = /^rlsfixture-\d{10,}-[a-z0-9]{4,12}(-[a-z0-9-]+)?$/i;

/** Create a fresh, unique run tag for one suite execution. */
export function createRunTag() {
  return `rlsfixture-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

export function isFixtureRunTag(tag) {
  return typeof tag === "string" && RUN_TAG_RE.test(tag);
}

/** Fixture org/project display name: marker + run tag + suffix. */
export function fixtureName(runTag, suffix) {
  return `[${FIXTURE_MARKER}] ${runTag}-${suffix}`;
}

export function fixtureSlug(runTag, suffix) {
  return `${runTag}-${suffix}`;
}

export function fixtureEmail(runTag, label) {
  return `${runTag}-${label}@${FIXTURE_EMAIL_DOMAIN}`;
}

/** Metadata stamped on every fixture auth user. */
export function fixtureUserMetadata(runTag) {
  return { rls_fixture: FIXTURE_MARKER, rls_fixture_run: runTag };
}

/** SQL/PostgREST LIKE prefix that only fixture names can satisfy. */
export const ORG_NAME_LIKE = `[${FIXTURE_MARKER}]%`;
export const EMAIL_LIKE = `rlsfixture-%@${FIXTURE_EMAIL_DOMAIN}`;

function isProtectedEmail(email) {
  const e = String(email ?? "").toLowerCase();
  return PROTECTED_EMAIL_DOMAINS.some((d) => e.endsWith(d));
}

/**
 * An email is purgeable only if it is on the reserved fixture domain, matches
 * the tagged pattern, and is not on a protected real domain.
 */
export function isFixtureEmail(email) {
  if (!email) return false;
  if (isProtectedEmail(email)) return false;
  const e = String(email).toLowerCase();
  return e.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) && FIXTURE_EMAIL_RE.test(e);
}

/**
 * An auth user is purgeable only when the marker is present in BOTH its
 * user metadata and its email address.
 */
export function isFixtureUser(user) {
  if (!user) return false;
  const meta = user.user_metadata ?? {};
  const marked = meta.rls_fixture === FIXTURE_MARKER && isFixtureRunTag(meta.rls_fixture_run);
  return marked && isFixtureEmail(user.email);
}

/**
 * An organization is purgeable only when its name carries the marker AND the
 * tagged pattern AND its slug carries the same run tag.
 */
export function isFixtureOrg(org) {
  if (!org?.name) return false;
  if (PROTECTED_ORG_NAMES.includes(org.name)) return false;
  if (!org.name.includes(`[${FIXTURE_MARKER}]`)) return false;
  if (!FIXTURE_ORG_NAME_RE.test(org.name)) return false;
  if (org.slug !== undefined && org.slug !== null && !FIXTURE_SLUG_RE.test(org.slug)) return false;
  return true;
}

/** Projects are named with the same marker convention as orgs. */
export function isFixtureProjectName(name) {
  return !!name && name.includes(`[${FIXTURE_MARKER}]`) && FIXTURE_ORG_NAME_RE.test(name);
}

/** Catalog marker rows (gl codes, budget codes) are prefixed with the run tag. */
export function isFixtureCode(code) {
  return !!code && /^rlsfixture-\d{10,}-[a-z0-9]{4,12}-/i.test(code);
}
