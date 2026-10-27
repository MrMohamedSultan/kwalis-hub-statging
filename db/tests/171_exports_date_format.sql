\set A '00000000-0000-0000-0000-00000000000a'
\set D '00000000-0000-0000-0000-00000000000d'
\set O1 '10000000-0000-0000-0000-000000000001'
\set O2 '10000000-0000-0000-0000-000000000002'
SELECT t.eq('existing companies default to dd/MM/yyyy', (SELECT date_format FROM organizations WHERE id = :'O1'), 'dd/MM/yyyy');
SELECT t.denied('unknown date format refused', $$UPDATE organizations SET date_format = 'yy/M/d' WHERE id = '10000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('javascript: logo refused', $$UPDATE organizations SET logo_url = 'javascript:alert(1)' WHERE id = '10000000-0000-0000-0000-000000000001'$$);
SELECT t.denied('svg data logo refused', $$UPDATE organizations SET logo_url = 'data:image/svg+xml;base64,PHN2Zz4=' WHERE id = '10000000-0000-0000-0000-000000000001'$$);
-- company admin D sets the format and a PNG logo for their own company
SELECT t.as_user(:'D');
UPDATE organizations SET date_format = 'MM/dd/yyyy', logo_url = 'data:image/png;base64,iVBORw0KGgo=' WHERE id = :'O1';
RESET ROLE;
SELECT t.eq('admin changed the format', (SELECT date_format FROM organizations WHERE id = :'O1'), 'MM/dd/yyyy');
SELECT t.eq('admin set a PNG logo', (SELECT logo_url FROM organizations WHERE id = :'O1'), 'data:image/png;base64,iVBORw0KGgo=');
-- plain member A cannot change company settings, admin D cannot touch another company
SELECT t.as_user(:'A');
SELECT t.denied('member cannot change the company format', $$UPDATE organizations SET date_format = 'yyyy-MM-dd' WHERE id = '10000000-0000-0000-0000-000000000001'$$);
SELECT t.eq('member can read the format', (SELECT date_format FROM organizations WHERE id = :'O1'), 'MM/dd/yyyy');
RESET ROLE;
SELECT t.as_user(:'D');
SELECT t.denied('admin cannot change another company', $$UPDATE organizations SET date_format = 'yyyy-MM-dd' WHERE id = '10000000-0000-0000-0000-000000000002'$$);
RESET ROLE;
SELECT t.eq('other company untouched', (SELECT date_format FROM organizations WHERE id = :'O2'), 'dd/MM/yyyy');
-- the file is re-runnable
\ir ../pending/171_exports_date_format.sql
SELECT t.eq('re-applied without change', (SELECT date_format FROM organizations WHERE id = :'O1'), 'MM/dd/yyyy');
UPDATE organizations SET date_format = 'dd/MM/yyyy', logo_url = NULL WHERE id = :'O1';
