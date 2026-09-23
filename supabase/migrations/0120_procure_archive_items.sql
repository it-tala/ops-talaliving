-- 0120_procure_archive_items.sql — Master Data phase 5: archive many items
-- at once, with the reason written once.
--
-- The catalogue's uncurated pile is not all goods. About a third of the
-- 1.042 items in production (2026-09-23) are ledger descriptions that became
-- "items" when the old sheet was imported: *payment to …*, *transfer …*,
-- *payroll july*, *uang makan*, *admin fee*, *tarik tunai*. Nobody will ever
-- request them, and they crowd every picker. The suggestion panel on the
-- Items screen finds them by name; this seam archives a whole group in one
-- call instead of one `archive_item` per row.
--
-- Archive, never delete: the ledger lines written against them keep
-- resolving, and `archive_item(code, false)` brings any one of them back.
-- Merged items are left alone — they are already out of every list.

create or replace function ops_procure.archive_items(p_codes text[], p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare v_codes text[]; v_reason text := nullif(btrim(p_reason), '');
begin
  if not ops_core.has_permission('procurement.update') then
    return ops_core.refused('procurement','item', null,'archive_many',
      'not_permitted','Archiving items needs procurement access.');
  end if;
  if coalesce(array_length(p_codes, 1), 0) = 0 then
    return ops_core.invalid('procurement','item', null,'archive_many',
      'codes_required','Pick at least one item.', jsonb_build_object('field','codes'));
  end if;

  with done as (
    update ops_procure.items
       set archived_at = now(), archived_by = auth.uid()
     where code = any(p_codes) and merged_into is null and archived_at is null
    returning code
  )
  select coalesce(array_agg(code order by code), '{}') into v_codes from done;

  if coalesce(array_length(v_codes, 1), 0) = 0 then
    return ops_core.noop('procurement','item', null,'archive_many','Nothing to archive.',
      jsonb_build_object('archived', 0, 'codes', '[]'::jsonb));
  end if;

  return ops_core.say('procurement','item', null,'archive_many','ok', 200, null, v_reason,
    jsonb_build_object('archived', array_length(v_codes, 1), 'codes', to_jsonb(v_codes)),
    jsonb_build_object('codes', to_jsonb(v_codes), 'count', array_length(v_codes, 1)),
    null, jsonb_build_object('archived', true));
end $$;

grant execute on function ops_procure.archive_items(text[], text) to authenticated;
