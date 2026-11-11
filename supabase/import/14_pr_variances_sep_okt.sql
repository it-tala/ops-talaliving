-- 14_pr_variances_sep_okt.sql — the seven lines step 13 left APPROVED because
-- they were paid less than approved: the difference written on the PR line.
--
-- Owner, 2026-11-11: *catat semua ke ledger dan catat selisih pengajuan,
-- approved dan actual bayar di PR nya ops.*
--
-- All seven are already on the ledger: step 13 allocated each to the
-- transaction(s) that paid it. "Actual bayar" is what the ledger (= the bank)
-- holds. No transaction is created: where the sheet claims more than the bank
-- paid (SEP114, SEP117, OKT51) the sheet's figure is kept in the note, not
-- turned into a ledger row that no bank statement backs.
--
-- Per line, one of each, by it@ (who asked):
--   ops_procure.line_variances   reason + note: diajukan · disetujui · dibayar ·
--                                selisih, and which transactions paid it —
--                                what the PR screen shows as the explanation
--   ops_procure.line_settlements the shortfall (approved − paid) closed with the
--                                same reason, so the line stops reading as owed
--
-- Idempotent: a line that already has a settlement is skipped.

do $v$
declare
  v_it uuid := (select id from ops_core.users where email = 'it@talaliving.com');
  r record;
  v_paid numeric; v_appr numeric; v_req numeric; v_trx text; v_note text; n int := 0;
begin
  for r in select * from (values
    ('pr-26-10-05_01-L01', 'other'::ops_procure.variance_reason_t, 42457897::numeric,
     'Payroll staf September. Pengajuan di web Rp 47.076.119, di sheet OKTOBER Rp 42.457.897; yang ditransfer 13 orang + 10 biaya admin = Rp 33.400.397. Sheet mencatat selisih Rp 9.057.500 tanpa keterangan; tidak ada transfer lain untuk payroll September di ledger.'),
    ('pr-26-09-30_01-L04', 'other', 2800000,
     'Plywood 12 mm semi meranti 10 lembar @280.000. Sheet menulis dibayar Rp 2.800.000, ledger hanya punya Rp 2.300.000 (PLYWOOD TOP SILVER SEMI MERANTI 12 MM, Mojo Indah). Selisih Rp 500.000 tidak ada di rekening.'),
    ('pr-26-10-15_01-L04', 'other', 1765002,
     'Daily payroll minggu 3 Oktober. Sheet menulis dibayar Rp 1.765.002; ledger: Nur, Kiddo, Al Jami, Saidun, Roni, Niam = Rp 1.725.002. Rp 40.000 tidak ditemukan di ledger.'),
    ('pr-26-10-12_01-L04', 'partial_payment', 1000000,
     'Belanja Saripan 12/10. Disetujui Rp 1.000.000, ditransfer Rp 500.000 (sheet: SISA 87000, unpaid Rp 0).'),
    ('pr-26-10-05_08-L02', 'price_changed', 450000,
     'Service AC office (Bintang AC). Disetujui Rp 450.000, dibayar Rp 400.000 (servis + freon).'),
    ('pr-26-10-08_03-L05', 'price_changed', 150000,
     'Kartu Halo office. Disetujui Rp 150.000, tagihan yang dibayar Rp 114.500.'),
    ('pr-26-09-30_01-L07', 'price_changed', 1115000,
     'Lem Unichem 1 sak. Disetujui Rp 1.115.000; ledger Rp 1.110.000 (PT Unitec Artha). Sheet menulis dibayar Rp 1.115.000.')
  ) as t(line_no, reason, sheet_req, note)
  loop
    if exists (select 1 from ops_procure.line_settlements s join ops_procure.pr_lines l on l.id = s.line_id
                where l.line_no_full = r.line_no) then
      continue;
    end if;
    select v.requested, v.approved, v.paid into v_req, v_appr, v_paid
      from ops_procure.v_line_variance v join ops_procure.pr_lines l on l.id = v.line_id
     where l.line_no_full = r.line_no;
    if v_paid is null or v_paid >= v_appr then
      raise exception '% is not paid short (approved %, paid %)', r.line_no, v_appr, v_paid;
    end if;
    select string_agg(t.trx_no || ' Rp ' || replace(to_char(a.amount, 'FM999G999G999'), ',', '.'), ', ' order by t.trx_no) into v_trx
      from ops_acct.payment_allocations a join ops_acct.transactions t on t.id = a.trx_id
     where a.pr_line_no = r.line_no and a.superseded_by is null;
    v_note := format('Diajukan Rp %s · disetujui Rp %s · dibayar Rp %s · selisih Rp %s. %s Ledger: %s.',
      replace(to_char(r.sheet_req, 'FM999G999G999'), ',', '.'), replace(to_char(v_appr, 'FM999G999G999'), ',', '.'),
      replace(to_char(v_paid, 'FM999G999G999'), ',', '.'), replace(to_char(v_appr - v_paid, 'FM999G999G999'), ',', '.'),
      r.note, coalesce(v_trx, '-'));

    insert into ops_procure.line_variances (line_id, reason, note, amount_at_time, recorded_by, recorded_by_email)
    select l.id, r.reason, v_note, v_paid - v_appr, v_it, 'it@talaliving.com'
      from ops_procure.pr_lines l where l.line_no_full = r.line_no;

    insert into ops_procure.line_settlements (line_id, shortfall, reason, decided_by)
    select l.id, v_appr - v_paid, v_note, v_it
      from ops_procure.pr_lines l where l.line_no_full = r.line_no;
    n := n + 1;
  end loop;
  raise notice '% lines settled', n;
end
$v$;
