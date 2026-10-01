-- prod — the PLV rate card in the rate list and the norms (0200, D355).
--
--   DATA         26 PLV rates exist, active, one each, coded in sequence; 27
--                norms in category PLV; none of the PLV norms can be read as
--                a line's waste by name + % (the words wasteFromNorm keys on)
--   IDEMPOTENT   running the file's inserts again adds nothing
--   SAFETY       on this ladder no bought-timber rate exists, so the basis
--                sentence must not have landed on any PLV rate (found by name)

begin;

do $$
declare n int;
begin
  select count(*) into n from ops_prod.bom_rates
   where active and (name like '% — per m³ komponen (%' or name like '%(PLV)');
  assert n = 26, format('26 PLV rates, found %s', n);

  select count(*) into n from ops_prod.bom_rates where name like 'Jati tier %' or name like 'Mindi tier %' or name like 'Meranti semua tier%';
  assert n = 11, format('11 timber tier rates, found %s', n);

  assert (select count(*) from ops_prod.bom_rates where note like 'Dasar: per m³ log%' or note like 'Dasar: per m³ balok%') = 0,
    'the basis sentence for bought timber never lands on a PLV rate';

  assert (select count(*) from ops_prod.bom_rates r where r.code !~ '^RT-[0-9]{4,}$') = 0, 'every code is RT-nnnn';

  select count(*) into n from ops_prod.bom_norms where category = 'PLV';
  assert n = 27, format('27 PLV norms, found %s', n);

  assert (select count(*) from ops_prod.bom_norms
           where category = 'PLV' and unit = '%'
             and norm ~* '(waste|susut|scrap|breakage|pecah|yield|rendemen)') = 0,
    'no PLV norm reads as a line waste by name';

  assert (select value from ops_prod.bom_norms where category = 'PLV' and norm = 'NARROW_MAX_SECTION') = 40,
    'the 30 Sep 40 × 40 rule is in';
end $$;

-- A second run of the rate insert adds nothing (same name, active).
with before as (select count(*) as c from ops_prod.bom_rates)
insert into ops_prod.bom_rates (code, name, rate_group, uom, unit_rate, active)
select 'RT-9999', 'Jati tier B — per m³ komponen (rendemen 2,5, processing dan upah tukang di dalam)', 'kayu', 'm3', 1, true
 where not exists (select 1 from ops_prod.bom_rates x
                    where lower(btrim(x.name)) = lower('Jati tier B — per m³ komponen (rendemen 2,5, processing dan upah tukang di dalam)') and x.active);
do $$ begin
  assert not exists (select 1 from ops_prod.bom_rates where code = 'RT-9999'), 'a PLV rate is not inserted twice';
end $$;

rollback;
