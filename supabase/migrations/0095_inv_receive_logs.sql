-- 0095_inv_receive_logs.sql — the one inventory write that touches three
-- tables in one breath, given the seam the other two never needed.
--
-- `addLog`, `reportBoards` and `markLogSawn` are each one row against a load
-- that already exists, and `0070`'s RLS alone is enough for them — the same
-- shape `0071` chose for `stock_moves`. A load arriving is different: the
-- purchase, its logs and any boards read straight off the nota are one fact,
-- reported together, and PostgREST gives each `.insert()` its own
-- transaction. Three separate calls from the client would let a purchase row
-- exist with no logs behind it if the second call failed — not a business
-- rule this schema decided to relax, just three requests where the demo's
-- `apply()` makes one write.
create or replace function ops_inv.receive_logs(
  p_vendor_code text, p_received_on date, p_species text, p_total_cost bigint,
  p_claimed_m3 numeric default null, p_measure ops_inv.log_measure_t default 'round',
  p_trx_no text default null, p_pr_line_no text default null, p_note text default null,
  -- `[{"tag":"#1","diameter_cm":32,"length_cm":250}, ...]`
  p_logs jsonb default '[]'::jsonb,
  -- `[{"thickness_mm":30,"width_mm":200,"length_mm":2000,"qty":12,"grade":"A"}, ...]`
  -- Filed as boards, never as ledger lines (D200) — the same rule
  -- `receiveLogs`'s own contract states.
  p_boards jsonb default '[]'::jsonb,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_inv, ops_core, pg_temp as $$
declare
  v_purchase_id uuid;
  v_purchase_no text;
  v_vendor_id   uuid;
  v_log         jsonb;
  v_board       jsonb;
  replayed      jsonb;
  res           jsonb;
begin
  replayed := ops_core.idem_replay('inventory', 'receive_logs', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('inventory.create') then
    return ops_core.refused('inventory', 'log_purchase', null, 'receive',
      'not_permitted', 'Menerima kiriman kayu perlu akses inventory.');
  end if;
  select id into v_vendor_id from ops_procure.vendors where code = p_vendor_code;
  if not found then
    return ops_core.not_found('inventory', 'log_purchase', p_vendor_code, 'receive', 'Vendor itu tidak ada.');
  end if;
  if coalesce(btrim(p_species), '') = '' then
    return ops_core.invalid('inventory', 'log_purchase', null, 'receive',
      'species_required', 'Kayu apa?', jsonb_build_object('field', 'species'));
  end if;
  if p_total_cost is null or p_total_cost <= 0 then
    return ops_core.invalid('inventory', 'log_purchase', null, 'receive',
      'cost_required',
      'Tanpa nilai tagihan, tidak ada harga per m³ yang bisa dihitung — dan itu satu-satunya alasan catatan ini ada.',
      jsonb_build_object('field', 'total_cost'));
  end if;

  insert into ops_inv.log_purchases
    (vendor_code, trx_no, pr_line_no, received_on, species, total_cost,
     claimed_m3, measure, note, created_by)
  values
    (p_vendor_code, p_trx_no, p_pr_line_no, p_received_on, btrim(p_species), round(p_total_cost),
     p_claimed_m3, p_measure, nullif(btrim(p_note), ''), auth.uid())
  returning id, purchase_no into v_purchase_id, v_purchase_no;

  for v_log in select * from jsonb_array_elements(coalesce(p_logs, '[]'::jsonb)) loop
    insert into ops_inv.log_pieces (purchase_id, tag, diameter_cm, length_cm)
    values (
      v_purchase_id,
      coalesce(nullif(btrim(v_log ->> 'tag'), ''),
        '#' || (1 + (select count(*) from ops_inv.log_pieces where purchase_id = v_purchase_id))::text),
      (v_log ->> 'diameter_cm')::numeric, (v_log ->> 'length_cm')::numeric);
  end loop;

  for v_board in select * from jsonb_array_elements(coalesce(p_boards, '[]'::jsonb)) loop
    insert into ops_inv.sawn_boards
      (purchase_id, log_id, thickness_mm, width_mm, length_mm, qty, sawn_on, grade, note)
    values (
      v_purchase_id, null,
      (v_board ->> 'thickness_mm')::int, (v_board ->> 'width_mm')::int, (v_board ->> 'length_mm')::int,
      (v_board ->> 'qty')::int, p_received_on, nullif(v_board ->> 'grade', ''), 'Dari nota.');
  end loop;

  perform ops_core.emit('inventory', 'inventory.log_purchase.received', v_purchase_no,
    jsonb_build_object('purchase_no', v_purchase_no, 'vendor_code', p_vendor_code, 'cost', p_total_cost,
      'from_nota', jsonb_build_object(
        'logs', jsonb_array_length(coalesce(p_logs, '[]'::jsonb)),
        'boards', jsonb_array_length(coalesce(p_boards, '[]'::jsonb)))));

  res := ops_core.ok('inventory', 'log_purchase', v_purchase_no, 'receive',
    jsonb_build_object('purchase_no', v_purchase_no));
  return ops_core.idem_remember('inventory', 'receive_logs', p_key, res);
end $$;

grant execute on function
  ops_inv.receive_logs(text, date, text, bigint, numeric, ops_inv.log_measure_t, text, text, text, jsonb, jsonb, text)
  to authenticated;
