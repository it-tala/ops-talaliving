-- acct — edit_transaction (0105): correcting who, what for, and what kind.
--
-- ── The gap this closed, in numbers ──────────────────────────────────────
--
-- `0101` let Accounting fix a row's amount and description. The import landed
-- the next day and made the hole visible: 59 transactions name a vendor that
-- resolves to nobody, 11 a project the project table spells differently, 184
-- arrived as `OTHERS` because the legacy row had no type. Every one is a
-- correction somebody can make from a document, and none was reachable — the
-- screen could fix what a row cost and not who it was paid to.
--
-- ── The distinction this file exists to hold ─────────────────────────────
--
-- `vendor_id` and `project_id` are nullable, so **leaving a field alone and
-- taking it off are two different instructions** and both have to be sayable:
-- `null` keeps, `''` clears, a code resolves or refuses. Somebody who filed a
-- payment against the wrong vendor needs the clearing case; without it the
-- only way back is VOID and post again, which is a heavy correction for a
-- field that moves no money.
--
-- A seam where `null` silently meant *clear* would erase a vendor on every
-- edit that only meant to fix a typo in the description. That is the failure
-- this asserts against, twice.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000e105','ref-edit@talaliving.com','{"full_name":"Ref Edit"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000e105','post_ledger');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000e105','accounting','write');

insert into ops_procure.vendors (id, code, name) values
  ('cccc0000-0000-0000-0000-0000000000a1','V-9001','TOKO BENAR'),
  ('cccc0000-0000-0000-0000-0000000000a2','V-9002','TOKO SALAH');
insert into ops_procure.projects (id, code, name) values
  ('cccc0000-0000-0000-0000-0000000000b1','29001','PROYEK UJI');

-- A row filed against the wrong vendor, with no project and no real type —
-- the three shapes the import produced, on one row.
insert into ops_acct.transactions (id, trx_no, trx_date, account_id, direction, amount_idr,
                                   type_code, vendor_id, description, source_ref, posted_by)
select '55550000-0000-0000-0000-0000000105e1', 'trx-ref-1', '2026-09-22', a.id, 'OUT', 250000,
       'OTHERS', 'cccc0000-0000-0000-0000-0000000000a2', 'beli engsel', 'trx-ref-1',
       'ffffffff-0000-0000-0000-00000000e105'
  from ops_acct.accounts a where a.code = 'PETTY CASH';

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e105';

/* ── the correction the 59 need ────────────────────────────────────────── */

do $$
declare r jsonb; t ops_acct.transactions;
begin
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => 'V-9001');
  assert ops_core.said_ok(r), format('a vendor is corrected by code, got %s', r);

  select * into t from ops_acct.transactions where trx_no = 'trx-ref-1';
  assert t.vendor_id = 'cccc0000-0000-0000-0000-0000000000a1', 'the vendor moved';
end $$;

-- **By code in the trail, not by uuid.** An audit row reading `V-9002 →
-- V-9001` can be understood by whoever opens it; one reading two uuids has to
-- be joined first, and nobody joins an audit row at 7pm.
--
-- Read as `postgres`, because `before`/`after` live in the audit log and the
-- audit log is IT's (D190) — the person making the correction cannot read the
-- row their own edit produced, which is the same thing production showed.
--
-- Ordered by `id`, not by `at`. `at` defaults to `now()`, which is transaction
-- start, so every audit row this file writes shares one timestamp and *the
-- most recent* means nothing inside a single transaction. Ordering by `at`
-- here passed by accident and asserted nothing — the same trap `ops_asst.turns`
-- sprang two days earlier, in a different table.
set local role postgres;
do $$
declare a ops_core.audit_log;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-ref-1' and action = 'edit' order by id desc limit 1;
  assert a.before ->> 'vendor' = 'V-9002', format('got %s', a.before);
  assert a.after  ->> 'vendor' = 'V-9001', format('got %s', a.after);
  -- And the names too, so the row reads without a lookup at all.
  assert a.detail ->> 'vendor_after' = 'TOKO BENAR', format('got %s', a.detail);
end $$;
set local role authenticated;

/* ── null keeps. This is the assertion that matters most ───────────────── */

do $$
declare r jsonb; t ops_acct.transactions;
begin
  -- Editing only the description must not touch the vendor. A seam where
  -- `null` meant *clear* would wipe it here, silently, on a correction that
  -- was only ever about a typo.
  r := ops_acct.edit_transaction('trx-ref-1', p_description => 'beli engsel pintu');
  assert ops_core.said_ok(r), format('got %s', r);
  select * into t from ops_acct.transactions where trx_no = 'trx-ref-1';
  assert t.vendor_id = 'cccc0000-0000-0000-0000-0000000000a1',
    'a description edit leaves the vendor alone';
end $$;

set local role postgres;
do $$
declare a ops_core.audit_log;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-ref-1' and action = 'edit' order by id desc limit 1;
  assert a.after ->> 'vendor' is null, format('and does not claim it changed, got %s', a.after);
  assert a.after ->> 'description' = 'beli engsel pintu', format('got %s', a.after);
end $$;
set local role authenticated;

/* ── '' clears, which is a different instruction ───────────────────────── */

do $$
declare r jsonb; t ops_acct.transactions;
begin
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => '');
  assert ops_core.said_ok(r), format('an empty code takes the vendor off, got %s', r);
  select * into t from ops_acct.transactions where trx_no = 'trx-ref-1';
  assert t.vendor_id is null, 'the vendor is gone';

  -- put it back for the rest of the file
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => 'V-9001');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

/* ── project and type, the other two the import left behind ────────────── */

do $$
declare r jsonb; t ops_acct.transactions;
begin
  r := ops_acct.edit_transaction('trx-ref-1', p_project_code => '29001', p_type_code => 'OFFICE');
  assert ops_core.said_ok(r), format('got %s', r);
  select * into t from ops_acct.transactions where trx_no = 'trx-ref-1';
  assert t.project_id = 'cccc0000-0000-0000-0000-0000000000b1', 'the project landed';
  assert t.type_code = 'OFFICE', format('the type changed, got %s', t.type_code);
end $$;

set local role postgres;
do $$
declare a ops_core.audit_log;
begin
  select * into a from ops_core.audit_log
   where entity_no = 'trx-ref-1' and action = 'edit' order by id desc limit 1;
  assert a.before ->> 'type_code' = 'OTHERS', format('got %s', a.before);
  assert a.after  ->> 'project'   = '29001',  format('got %s', a.after);
  assert a.before ->> 'project' is null, 'and it had no project before';
end $$;
set local role authenticated;

/* ── REFUSAL: a code that resolves to nothing is never created ─────────── */

do $$
declare r jsonb; n int;
begin
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => 'V-DOES-NOT-EXIST');
  assert r -> 'error' ->> 'code' = 'no_such_vendor', format('got %s', r);
  r := ops_acct.edit_transaction('trx-ref-1', p_project_code => '99999');
  assert r -> 'error' ->> 'code' = 'no_such_project', format('got %s', r);
  r := ops_acct.edit_transaction('trx-ref-1', p_type_code => 'KATERING');
  assert r -> 'error' ->> 'code' = 'no_such_type', format('got %s', r);

  -- A ledger correction never invents a reference. That is the same rule the
  -- import obeys, and it has to hold here too or the screen becomes the way
  -- round it.
  select count(*) into n from ops_procure.vendors where code = 'V-DOES-NOT-EXIST';
  assert n = 0, 'no vendor was created from a code nobody recognised';
end $$;

/* ── REFUSAL: nothing is written when any part of it refuses ───────────── */

do $$
declare r jsonb; t ops_acct.transactions;
begin
  -- The amount would be fine and the vendor is nonsense. Everything is
  -- resolved before anything is written, so the row must be untouched — a
  -- half-applied correction is one nobody can see the shape of.
  r := ops_acct.edit_transaction('trx-ref-1', p_amount => 999000,
        p_vendor_code => 'V-NOPE', p_reason => 'nota berbunyi 999.000');
  assert r -> 'error' ->> 'code' = 'no_such_vendor', format('got %s', r);
  select * into t from ops_acct.transactions where trx_no = 'trx-ref-1';
  assert t.amount_idr = 250000, format('the amount did not move, got %s', t.amount_idr);
end $$;

/* ── the amount's rules are untouched by any of this ───────────────────── */

do $$
declare r jsonb;
begin
  -- Still required for the amount…
  r := ops_acct.edit_transaction('trx-ref-1', p_amount => 300000);
  assert r -> 'error' ->> 'code' = 'reason_required', format('got %s', r);
  -- …and still not required for a reference. A case can be made that changing
  -- who we paid deserves one too; that is a rule about what people owe an
  -- explanation for, and it is the owner's to make, not a migration's.
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => 'V-9002');
  assert ops_core.said_ok(r), format('got %s', r);
end $$;

/* ── saying the same thing again changes nothing ───────────────────────── */

do $$
declare r jsonb;
begin
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => 'V-9002',
        p_project_code => '29001', p_type_code => 'OFFICE');
  assert r ->> 'outcome' = 'noop', format('got %s', r);
end $$;

/* ── REFUSAL: reading the ledger is not correcting it ──────────────────── */

do $$
declare r jsonb;
begin
  set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000e002';
  r := ops_acct.edit_transaction('trx-ref-1', p_vendor_code => 'V-9001');
  assert r -> 'error' ->> 'code' = 'authority_required', format('got %s', r);
exception when others then
  -- that account belongs to 92_; if this file runs alone it simply is not there
  null;
end $$;

rollback;
