-- =====================================================================
-- D22 — the same person written more than one way.   READ ONLY, changes nothing.
--
-- Payments, WHT and the rebate still find a person by their NAME, so
-- "Mohammed Abdullah Alajmi" / "Moahmmed Abdullah AlAjami" or a trailing
-- space split one person in two. Merging people is a decision about real
-- records and is NOT done automatically (standing rule: no matching by name).
-- This only lists the candidates so someone who knows them can decide.
--
-- Two names are proposed as the same person when, inside one project, they
-- are equal after lower-casing and removing every space, dot, dash and
-- apostrophe — or when they share the same first and last word and the same
-- number of words (catches a single mistyped middle letter).
-- =====================================================================
WITH names AS (
  SELECT 'people' AS src, p.project_id, p.id::text AS ref, p.full_name AS name FROM public.people p
  UNION ALL SELECT 'crew_members', c.project_id, c.id::text, c.full_name FROM public.crew_members c
  UNION ALL SELECT 'payroll', r.project_id, r.id::text, r.name FROM public.payroll r
  UNION ALL SELECT 'payroll_payments', pp.project_id, pp.id::text, pp.beneficiary_name FROM public.payroll_payments pp
),
norm AS (
  SELECT n.*,
         lower(regexp_replace(n.name, '[\s.''’`_-]+', '', 'g'))                 AS squashed,
         lower(split_part(btrim(n.name), ' ', 1))                                 AS first_word,
         lower(reverse(split_part(reverse(btrim(n.name)), ' ', 1)))               AS last_word,
         array_length(regexp_split_to_array(btrim(n.name), '\s+'), 1)             AS words
  FROM names n
  WHERE btrim(COALESCE(n.name, '')) <> ''
),
spellings AS (   -- every distinct spelling per project, with where it is used
  SELECT project_id, name, squashed, first_word, last_word, words,
         string_agg(DISTINCT src, ', ' ORDER BY src) AS used_in, count(*) AS rows
  FROM norm GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT pr.code AS project, a.name AS spelling_a, b.name AS spelling_b,
       CASE WHEN a.squashed = b.squashed THEN 'same after removing spaces/punctuation/case'
            ELSE 'same first and last word' END AS why,
       a.used_in AS a_used_in, a.rows AS a_rows, b.used_in AS b_used_in, b.rows AS b_rows
FROM spellings a
JOIN spellings b
  ON b.project_id IS NOT DISTINCT FROM a.project_id
 AND a.name < b.name
 AND (a.squashed = b.squashed
      OR (a.first_word = b.first_word AND a.last_word = b.last_word AND a.words = b.words AND a.words >= 2))
LEFT JOIN public.projects pr ON pr.id = a.project_id
ORDER BY 1, 2;

-- Payroll rows whose name matches nobody in people — these are the rows the
-- rebate and WHT reports treat as "nationality not recorded".
SELECT pr.code AS project, r.name, count(*) AS payroll_rows, sum(r.total_amount) AS amount
FROM public.payroll r
LEFT JOIN public.projects pr ON pr.id = r.project_id
WHERE NOT EXISTS (SELECT 1 FROM public.people p WHERE p.project_id = r.project_id AND p.full_name = r.name)
GROUP BY 1, 2
ORDER BY 1, 2;
