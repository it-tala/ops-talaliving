-- 0196 — several places people clock in from, added, changed and removed (D343).
--
-- The owner (HRD evaluation): *presensi berlokasi harus bisa menyimpan
-- beberapa lokasi, diedit, ditambah dan hapus.* `0188` already made a site a
-- row keyed by code, and `judge_location` already judges a phone tap against
-- the **nearest** active site — so adding and changing were a screen away.
-- What no seam could do was take a site out.
--
-- `remove_work_site` deletes a site nothing was ever judged against: a point
-- typed in the wrong place, a site set up twice. A site that judged even one
-- tap is **refused, with the count**, and the answer is to switch it off:
-- `scan_locations.site_id` points at it, and a tap whose reading says *142 m
-- from Gudang* must still be able to say which Gudang (A5, taps stay facts).
-- Deactivating keeps the row and stops judging against it, which is what
-- "we do not work there any more" means.

create or replace function ops_hr.remove_work_site(
  p_code text,
  p_key  text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_code text := upper(btrim(coalesce(p_code, '')));
  v_site ops_hr.work_sites; v_used int; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','remove_work_site', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not (ops_core.has_permission('hrd.update') or ops_core.has_permission('it.update')) then
    return ops_core.refused('hr','work_site', v_code,'remove',
      'not_permitted','Lokasi kerja diatur oleh HRD atau IT.');
  end if;

  select * into v_site from ops_hr.work_sites where code = v_code;
  if not found then
    return ops_core.not_found('hr','work_site', v_code,'remove',
      format('Tidak ada lokasi %s.', v_code));
  end if;

  select count(*) into v_used from ops_hr.scan_locations where site_id = v_site.id;
  if v_used > 0 then
    return ops_core.conflict('hr','work_site', v_code,'remove',
      'site_in_use',
      format('%s sudah dipakai menilai %s tap, jadi tidak bisa dihapus — nonaktifkan saja: '
             'tap berikutnya tidak dinilai terhadapnya, dan riwayat tap lama tetap bisa dibaca.',
             v_site.name, v_used));
  end if;

  delete from ops_hr.work_sites where id = v_site.id;

  v_res := ops_core.ok('hr','work_site', v_code,'remove',
    jsonb_build_object('code', v_site.code, 'name', v_site.name));
  return ops_core.idem_remember('hr','remove_work_site', p_key, v_res);
end $$;

revoke execute on function ops_hr.remove_work_site(text, text) from public;
grant execute on function ops_hr.remove_work_site(text, text) to authenticated;
