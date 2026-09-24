-- 0149 — an approved payroll run is paid from its own page, and the ledger
-- says so in the same breath.
--
-- Found by the HR walk (F154). `approve_payroll_run` moves a run to APPROVED
-- and emits `payroll.approved`, which nothing consumes. `record_payroll_paid`
-- moves it to PAID — given the number of a ledger transaction somebody has
-- already written by hand — and nothing in the application calls it. So from
-- the screens a run stopped at APPROVED for ever, and the week's wages sat in
-- the ledger, if at all, as an OUT row that named no run.
--
-- The shape is `post_to_po`'s (0139, B8): the person who can write the ledger
-- pays the thing from the thing's page, and one call writes the transaction
-- and marks what it paid. Two calls from the browser would leave a
-- transaction with no run whenever the second one failed.
--
-- Three things this deliberately does **not** do:
--
-- * **It does not refuse an amount that differs from the run.** Which figure a
--   run pays — gross plus adjustments, or that less the employee's BPJS half —
--   is still Q56. Enforcing either would be answering it here. Both figures
--   come back beside the amount, the same as `record_payroll_paid` reports them.
-- * **It writes no per-person line to the ledger.** The ledger is read by
--   everybody in accounting; individual pay is not (D218). One line: the run.
-- * **It does not need payroll access.** Finance pays; it does not prepare the
--   run. The authority is `post_ledger`, the same as every other ledger write,
--   and the run is marked PAID here rather than through `record_payroll_paid`,
--   whose `payroll.run` check is about the people who prepare runs.

create or replace function ops_acct.post_payroll_run(
  p_run_no        text,
  p_amount        numeric,
  p_account_code  text,
  p_attachment_id uuid,
  p_trx_date      date default null,
  p_type_code     text default null,
  p_document_kind text default 'Payment Proof',
  p_key           text default null)
returns jsonb language plpgsql security definer
set search_path = ops_acct, ops_core, ops_hr, pg_temp as $$
declare
  v_run ops_hr.payroll_runs; v_type text; posted jsonb; v_trx_no text;
  t ops_hr.payroll_totals_t; replayed jsonb; res jsonb; v_label text;
begin
  replayed := ops_core.idem_replay('accounting','post_payroll_run:' || coalesce(p_run_no,'?'), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_authority('post_ledger') then
    return ops_core.refused('accounting','transaction', p_run_no,'post_payroll_run',
      'authority_required',
      'Posting to the ledger belongs to Accounting — logged, not applied.',
      jsonb_build_object('required','post_ledger','attempted_amount', p_amount));
  end if;

  select r.* into v_run from ops_hr.payroll_runs r where r.run_no = p_run_no for update;
  if not found then
    return ops_core.invalid('accounting','transaction', p_run_no,'post_payroll_run',
      'run_not_found', format('Tidak ada run gaji %s.', p_run_no), jsonb_build_object('field','run_no'));
  end if;
  if v_run.status = 'DRAFT' then
    return ops_core.conflict('accounting','transaction', p_run_no,'post_payroll_run',
      'not_approved','Belum ada yang menandatangani run ini. Gaji dibayar setelah disetujui, bukan sebelum.');
  end if;
  if v_run.status = 'PAID' then
    return ops_core.conflict('accounting','transaction', p_run_no,'post_payroll_run',
      'already_paid', format('%s sudah dibayar lewat %s.', p_run_no, v_run.paid_trx_no));
  end if;
  if p_amount is null or p_amount <= 0 then
    return ops_core.invalid('accounting','transaction', p_run_no,'post_payroll_run',
      'amount_positive','A payment is more than nothing.', jsonb_build_object('field','amount'));
  end if;
  if p_attachment_id is null then
    return ops_core.invalid('accounting','transaction', p_run_no,'post_payroll_run',
      'evidence_required',
      'A payment needs its proof. Attach the transfer receipt before recording it.',
      jsonb_build_object('field','attachment_id'));
  end if;

  -- A week is a weekly run and anything longer a monthly one — the two
  -- recurring types the cash plan already forecasts against (86).
  v_type := coalesce(nullif(btrim(p_type_code), ''),
                     case when v_run.period_end - v_run.period_start <= 7
                          then 'RECCURING - PAYROLL WEEKLY' else 'RECCURING - PAYROLL MONTHLY' end);
  v_label := format('Gaji %s (%s s/d %s)', p_run_no,
                    to_char(v_run.period_start, 'DD Mon'), to_char(v_run.period_end, 'DD Mon YYYY'));

  posted := ops_acct.post_transaction(
    p_account_code => p_account_code,
    p_direction    => 'OUT',
    p_amount       => p_amount,
    p_type_code    => v_type,
    p_description  => v_label,
    p_documents    => jsonb_build_array(jsonb_build_object(
                        'attachment_id', p_attachment_id,
                        'kind', coalesce(nullif(btrim(p_document_kind), ''), 'Payment Proof'))),
    p_trx_date     => p_trx_date,
    p_source_ref   => format('payroll:%s', p_run_no),
    p_key          => null);
  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;
  v_trx_no := posted -> 'data' ->> 'trx_no';

  update ops_hr.payroll_runs set status = 'PAID', paid_trx_no = v_trx_no where id = v_run.id;

  select * into t from ops_hr.payroll_totals(v_run.period_start, v_run.period_end, p_run_no);

  perform ops_core.emit('hr','payroll.paid', p_run_no,
    jsonb_build_object('run_no', p_run_no, 'trx_no', v_trx_no, 'amount', p_amount));

  res := ops_core.ok('accounting','transaction', v_trx_no,'post_payroll_run',
    jsonb_build_object('trx_no', v_trx_no, 'run_no', p_run_no, 'amount', p_amount,
                       'account', p_account_code, 'type', v_type,
                       'gross_total', t.gross_total, 'adjustment_total', t.adjustment_total,
                       'net_total', t.net_total),
    jsonb_build_object('status', v_run.status),
    jsonb_build_object('status', 'PAID'));
  return ops_core.idem_remember('accounting','post_payroll_run:' || p_run_no, p_key, res);
end $$;

-- A new function is executable by PUBLIC, which `anon` inherits (0125).
revoke execute on function ops_acct.post_payroll_run(text, numeric, text, uuid, date, text, text, text) from public;
grant execute on function ops_acct.post_payroll_run(text, numeric, text, uuid, date, text, text, text) to authenticated;

comment on function ops_acct.post_payroll_run is
  'Pays an approved payroll run from its page: one ledger OUT transaction for the run (never per '
  'person) and the run marked PAID, in one call. post_ledger, not payroll access. The amount is '
  'not checked against the run while Q56 is open; both figures are returned. (0149, F154)';
