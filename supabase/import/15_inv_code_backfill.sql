-- 15_inv_code_backfill.sql — codes for the assets that were here before the code system.
--
-- 0293 gave every 2013 machine its code from its 2013 label, every catalogue
-- item its code from its category, and every asset made from now on a code at
-- insert. What it could not do is read a name: the assets registered before
-- (TVs, computers, a radial arm saw entered as "RADIAL ARMSAW" under *Tools*)
-- need a family chosen by what they are. The owner chose to assign them by
-- rule directly (D451) and correct a wrong one by recoding (`recode_asset`,
-- the old code kept). These are the rules, read off the names in production
-- on 2026-11-18; the first that matches wins, and an asset no rule matches
-- takes its category's default family.
--
-- Machines go to their 2013 family, so a saw bought after 2013 is the next
-- saw (`S2-29`), not a tool. Families that do not exist yet are made with
-- their letter's next number. Only an asset with no code is touched, so a
-- second run changes nothing; each assignment writes an audit row on the
-- asset, with no actor.
--
--   psql … -v ON_ERROR_STOP=1 -f supabase/import/15_inv_code_backfill.sql

begin;

create temp table _rules (ord int, pattern text, type_name text, label_en text, label_id text, asset_category text);
insert into _rules values
  -- machines, into their 2013 families
  ( 1, '\m(RADIAL ?ARM ?SAW|GERGAJI|SERKEL|REPSO|PANELSO|PANEL SAW|TABLE SAW|BEAM SAW|TENON)', 'SAW', 'Saw', 'Gergaji', 'machine'),
  ( 2, '\m(CHOP SAW|POTONG BESI)',                                  'METAL', 'Metal working', 'Pengerjaan logam', 'machine'),
  ( 3, '\m(SPINDLE MOULDER|SPINDEL|COPY SHAPER|MOULDER)',            'MOULDER', 'Moulder', 'Moulder', 'machine'),
  ( 4, '\m(AMPLAS|SANDER|SENDER)',                                   'SANDER', 'Sander', 'Amplas (sander)', 'machine'),
  ( 5, '\m(PLANNER|PLANER|SERUT)',                                   'PLANER', 'Planer', 'Serut (planer)', 'machine'),
  ( 6, '\mJOINTER',                                                  'JOINTER', 'Jointer', 'Jointer', 'machine'),
  ( 7, '\m(BOR HORIZONTAL|BORING|BOR SNAY)',                         'BORING', 'Boring', 'Bor (boring)', 'machine'),
  ( 8, '\mMESIN BOR',                                                'DRILL', 'Drill press', 'Bor duduk', 'machine'),
  ( 9, '\m(HOT PRESS|PRESS|PRES KAYU)',                              'PRESS', 'Press', 'Press', 'machine'),
  (10, '\m(KOMPRESOR|COMPRESSOR)',                                   'AIR COMPRESSOR', 'Air compressor', 'Kompresor udara', 'machine'),
  (11, '\mAIR DRYER',                                                'AIR DRYER', 'Air dryer', 'Pengering udara', 'machine'),
  (12, '\m(MESIN BUBUT|LATHE)',                                      'LATHE MACHINE', 'Lathe', 'Bubut', 'machine'),
  (13, '\m(POTONG VENEER|VENEER)',                                   'VENEER', 'Veneer', 'Veneer', 'machine'),
  (14, '\m(GLUE SPREADER|ROL LEM)',                                  'GLUE', 'Glue roller', 'Roller lem', 'machine'),
  (15, '\m(MESIN JAHIT|SEWING)',                                     'UPHOLSTERY', 'Upholstery', 'Jok (upholstery)', 'machine'),
  (16, '\m(MOLEN|CEMENT MIXER)',                                     'CONSTRUCTION', 'Construction equipment', 'Alat konstruksi', 'machine'),
  (17, '\mASAH GRAJI',                                               'TOOLROOM', 'Toolroom', 'Toolroom', 'machine'),
  (18, '\m(HEAT PUMP|WOOD DRYER|PENGERING KAYU)',                    'WOOD DRYER', 'Wood dryer (kiln)', 'Pengering kayu (oven)', 'machine'),
  (19, '\m(POMPA|PUMP)',                                             'PUMP', 'Pump', 'Pompa', 'tool'),
  (20, '\mSPRAY (BUT|GUN)',                                          'SPRAY GUN', 'Spray gun', 'Spray gun', 'tool'),
  (21, '\mROUTER BIT',                                               'ROUTER BIT', 'Router bit', 'Mata router', 'tool'),
  -- tools and equipment
  (30, '\mKUNCI',                                                    'WRENCH', 'Wrench', 'Kunci', 'tool'),
  (31, '\m(PENGGARIS|SIKU|MEASURING)',                               'MEASURING TOOL', 'Measuring tool', 'Alat ukur', 'tool'),
  (32, '\m(TROLY|TROLLEY|TROLI)',                                    'TROLLEY', 'Trolley', 'Troli', 'tool'),
  -- building and office equipment
  (40, '\m(AIR CONDITIONER|AC)\M',                                   'AIR CONDITIONER', 'Air conditioner', 'AC', 'other'),
  (41, '\mTV\M',                                                     'TELEVISION', 'Television', 'Televisi', 'other'),
  (42, '\mKIPAS',                                                    'FAN', 'Fan', 'Kipas angin', 'other'),
  (43, '\mDISPENSER',                                                'WATER DISPENSER', 'Water dispenser', 'Dispenser air', 'other'),
  (44, '\mKULKAS',                                                   'REFRIGERATOR', 'Refrigerator', 'Kulkas', 'other');

do $$
declare
  a        record;
  v_family text;
  v_code   text;
  n_rule   int := 0;
  n_default int := 0;
begin
  for a in
    select x.id, x.asset_no, x.name, x.category_code,
           (select r from _rules r where upper(x.name) ~ r.pattern order by r.ord limit 1) as rule
      from ops_inv.assets x
     where x.code is null
     order by x.asset_no
  loop
    if (a.rule).type_name is not null then
      v_family := ops_inv.ensure_code_family((a.rule).type_name, (a.rule).label_en, (a.rule).label_id, 'unit',
                                             (a.rule).asset_category, null, false);
      n_rule := n_rule + 1;
    else
      select code into v_family from ops_inv.code_families
       where category_default and asset_category_code = a.category_code;
      n_default := n_default + 1;
    end if;
    continue when v_family is null;
    v_code := ops_inv.next_code(v_family);
    update ops_inv.assets set code = v_code, family_code = v_family where id = a.id;
    perform ops_core.write_audit('inventory', 'asset', a.asset_no, 'assign_code', 'ok',
      format('Code %s in the one system (D451)', v_code), null,
      jsonb_build_object('code', v_code, 'family_code', v_family),
      jsonb_build_object('by', 'supabase/import/15_inv_code_backfill.sql',
                         'rule', (a.rule).pattern, 'from_category_default', (a.rule).type_name is null));
  end loop;
  raise notice 'coded % asset(s) by a rule and % by their category''s default family', n_rule, n_default;
end $$;

select (select count(*) from ops_inv.assets)                         as assets,
       (select count(*) from ops_inv.assets where code is null)      as without_code,
       (select count(*) from ops_procure.items i
         where not exists (select 1 from ops_inv.item_codes c where c.item_code = i.code)
           and exists (select 1 from ops_inv.code_families f where f.item_category_code = i.category_code)) as items_without_code,
       (select count(*) from ops_inv.code_families)                  as families;

commit;
