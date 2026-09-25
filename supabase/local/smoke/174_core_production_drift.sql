-- core — what production had alone, now in the ladder (0174, D315, F167).
--
--   * the five import/estimating tables exist, with RLS on and no policy
--   * `authenticated` holds no grant on them, and reading as a signed-in user
--     with every procurement right still sees nothing — the API cannot reach them
--   * `v_item_view` carries the evidence columns in production's order,
--     before `name_local`, and names its columns rather than `i.*`

begin;

do $$
declare t text; ord text;
begin
  foreach t in array array['ops_procure.item_master_staging','ops_procure.item_vendor_prices',
                           'ops_procure.item_vendor_prices_staging','ops_prod.bom_norms',
                           'ops_prod.finishing_recipes'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), format('%s has RLS on', t);
    assert not exists (select 1 from pg_policies p
                        where format('%I.%I', p.schemaname, p.tablename) = t),
      format('%s has no policy — nothing reads it through the API yet', t);
    assert not has_table_privilege('authenticated', t, 'select'),
      format('authenticated holds no select on %s', t);
  end loop;

  select string_agg(column_name, ',' order by ordinal_position) into ord
    from information_schema.columns
   where table_schema = 'ops_procure' and table_name = 'v_item_view'
     and column_name in ('archived_by','evidence_url','evidence_ref','name_local');
  assert ord = 'archived_by,evidence_url,evidence_ref,name_local',
    format('v_item_view keeps production''s column order, got %s', ord);
  assert pg_get_viewdef('ops_procure.v_item_view'::regclass) not like '%i.*%',
    'v_item_view names its columns';
end $$;

-- A row as the importer left it, then a signed-in reader with procurement
-- rights: RLS on and no policy is nothing, not an error.
insert into ops_prod.bom_norms (category, norm, value, unit, source_kind)
values ('smoke', 'plywood waste', 12, '%', 'empirical');

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-000000001741','proc-admin@talaliving.com','{"full_name":"Procurement admin"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('aaaa0000-0000-0000-0000-000000001741','procurement','admin'),
  ('aaaa0000-0000-0000-0000-000000001741','production','admin');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000001741';
do $$
begin
  begin
    perform 1 from ops_prod.bom_norms;
    assert false, 'a signed-in user cannot read bom_norms at all';
  exception when insufficient_privilege then null;
  end;
  -- The view the catalogue reads still answers, evidence columns and all.
  perform evidence_url, evidence_ref, name_local from ops_procure.v_item_view limit 1;
end $$;
reset role;

rollback;
