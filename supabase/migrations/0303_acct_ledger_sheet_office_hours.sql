-- 0303_acct_ledger_sheet_office_hours.sql — the GL OPS sheet job runs in office hours only (D461).
--
-- 0302 (D460) ran the job every 15 minutes from 06:00 to 22:59 WIB. The owner
-- narrowed it on 2026-11-25: *jadwal run nya dari jam 08.00-17.00 saja*.
--
-- 08:00–16:45 WIB every 15 minutes is 01:00–09:45 UTC; one cron expression
-- cannot also reach 17:00 without running to 17:45, so 17:00 is its own job.
-- A row recorded after 17:00 reaches the sheet at 08:00 the next morning, or
-- sooner if somebody presses *Perbarui sheet*.
--
-- Nothing else changes: the kick, the md5 skip and the daily forced write are
-- 0302's. `cron.schedule` with an existing name replaces that job.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-ledger-sheet-sync', '*/15 1-9 * * *',
                          'select ops_acct.kick_ledger_sheet_sync()');
    perform cron.schedule('ops-ledger-sheet-sync-1700', '0 10 * * *',
                          'select ops_acct.kick_ledger_sheet_sync()');
  end if;
end $$;
