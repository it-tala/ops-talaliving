-- 0025_acct_statement_seams.sql — the rekening koran road: a public number for
-- a statement, and the five decisions somebody makes about a line.
--
-- `0019` built the tables and `0020` the views. What was missing is the number
-- the screen identifies a statement by, and every write.
--
-- ── Why a statement needs a number at all ────────────────────────────────
--
-- `BankStatement.statement_no` is in the contract and was in no column.
-- Everything else in this system is addressed by its public code rather than
-- its uuid (ADR-004) — `pr-26-09-11_03`, `trx-26-09-10_014` — because a
-- reference nobody can read is a reference nobody checks, and because a uuid
-- in a WhatsApp message is not a thing anybody retypes. A bank statement is
-- more, not less, in need of that: it is the document two people compare when
-- the books and the bank disagree.
--
-- `rkk` is the demo's prefix, and the demo is the specification here. Choosing
-- a different one would mean the screens change, which is the one thing the
-- swap exists to avoid.

alter table ops_acct.bank_statements
  -- `not null` outright rather than nullable-then-backfilled: the ladder is
  -- replayed from nothing and no statement has ever been imported, so there is
  -- no row to backfill. The day that stops being true this has to become three
  -- statements instead of one.
  add column statement_no text not null unique;

insert into ops_core.doc_prefixes (prefix, what) values
  ('rkk', 'bank statement')
on conflict (prefix) do nothing;

-- The number joins the view the screen already reads.
-- Dropped and recreated rather than `create or replace`: replace can only
-- append a column, and `statement_no` belongs beside the id it stands in
-- for. The body below is `0020`'s, copied verbatim with one line added —
-- rewriting it by hand cost me `and status <> 'ignored'` on `awaiting_rate`
-- the first time, which would have counted a line somebody had already
-- decided as one still waiting for a rate.
drop view ops_acct.v_bank_statement;

create view ops_acct.v_bank_statement as
  select s.id, s.statement_no, s.account_id, a.code as account_code, a.name as account_name,
         s.period_start, s.period_end, s.opening_balance, s.closing_balance,
         s.currency, s.filename, s.status, s.attachment_id, s.note,
         s.uploaded_by, u.full_name as uploaded_by_name, s.uploaded_at,
         coalesce(l.movement, 0) as movement,
         s.opening_balance + coalesce(l.movement, 0) as computed_closing,
         -- What the bank printed against what its own lines add up to. They
         -- disagree when the file is partial, and that is worth **refusing to
         -- hide** (D182) — a statement that does not balance is the one case
         -- where the evidence itself is in question.
         abs(s.opening_balance + coalesce(l.movement, 0) - s.closing_balance)
           <= ops_core.money_tolerance() as balance_ok,
         coalesce(l.unmatched, 0) as unmatched,
         coalesce(l.matched, 0)   as matched,
         coalesce(l.booked, 0)    as booked,
         coalesce(l.ignored, 0)   as ignored,
         -- Lines in a foreign currency with no rate typed yet. They cannot
         -- reach the ledger, and the screen says how many rather than quietly
         -- leaving them out (D181).
         coalesce(l.awaiting_rate, 0) as awaiting_rate
    from ops_acct.bank_statements s
    join ops_acct.accounts a on a.id = s.account_id
    left join ops_core.users u on u.id = s.uploaded_by
    left join lateral (
      select sum(case when direction = 'IN' then amount else -amount end) as movement,
             count(*) filter (where status = 'unmatched') as unmatched,
             count(*) filter (where status = 'matched')   as matched,
             count(*) filter (where status = 'booked')    as booked,
             count(*) filter (where status = 'ignored')   as ignored,
             count(*) filter (where amount_idr is null and status <> 'ignored')
               as awaiting_rate
        from ops_acct.statement_lines where statement_id = s.id
    ) l on true;

alter view ops_acct.v_bank_statement set (security_invoker = on);
grant select on ops_acct.v_bank_statement to authenticated;

-- One statement's lines, as the screen lists them.
create or replace view ops_acct.v_statement_line as
  select sl.id, sl.statement_id, s.statement_no, sl.line_no, sl.value_date,
         sl.direction, sl.amount, sl.amount_idr, sl.fx_rate,
         sl.raw_description, sl.balance_after, sl.status, sl.trx_no, sl.note,
         coalesce(u.email, '') as decided_by, sl.decided_at
    from ops_acct.statement_lines sl
    join ops_acct.bank_statements s on s.id = sl.statement_id
    left join ops_core.users u on u.id = sl.decided_by;

alter view ops_acct.v_statement_line set (security_invoker = on);
grant select on ops_acct.v_statement_line to authenticated;

-- ── importing ─────────────────────────────────────────────────────────────

-- **The same period twice is a re-upload, not a second statement.** Refusing
-- it keeps one movement from being booked twice, which is the most expensive
-- mistake available on this screen: two ledger rows for one transfer, each
-- with a plausible document behind it, found weeks later by a balance that
-- will not reconcile.
create or replace function ops_acct.import_statement(
  p_account_code text,
  p_period_start date,
  p_period_end date,
  p_opening numeric,
  p_closing numeric,
  p_currency text,
  p_filename text,
  p_rows jsonb,                  -- [{"value_date":…,"direction":"IN","amount":…,"raw_description":…,"balance_after":…}]
  p_attachment_id uuid default null,
  p_note text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare acc ops_acct.accounts; clash text; v_no text; v_id uuid;
        v_cur text; n int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('accounting','import_statement', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('accounting.create') then
    return ops_core.refused('accounting','bank_statement', null,'import',
      'permission_required','Importing a statement belongs to Accounting.');
  end if;

  select * into acc from ops_acct.accounts where code = p_account_code;
  if not found then
    return ops_core.not_found('accounting','bank_statement', p_account_code,'import',
      format('There is no account %s.', p_account_code));
  end if;

  n := coalesce(jsonb_array_length(p_rows), 0);
  if n = 0 then
    return ops_core.invalid('accounting','bank_statement', null,'import',
      'no_rows','Tidak ada baris yang terbaca di file itu.',
      jsonb_build_object('field','rows'));
  end if;
  if p_period_end < p_period_start then
    return ops_core.invalid('accounting','bank_statement', null,'import',
      'period_backwards','A statement does not end before it begins.',
      jsonb_build_object('field','period_end'));
  end if;

  select s.statement_no into clash
    from ops_acct.bank_statements s
   where s.account_id = acc.id
     and s.period_start = p_period_start and s.period_end = p_period_end;
  if clash is not null then
    return ops_core.conflict('accounting','bank_statement', clash,'import',
      'period_already_uploaded',
      format('%s sudah memuat %s → %s untuk %s.', clash, p_period_start, p_period_end, acc.code));
  end if;

  v_cur := coalesce(nullif(btrim(p_currency), ''), acc.currency);
  v_no  := ops_core.next_doc_number('rkk');

  insert into ops_acct.bank_statements
    (statement_no, account_id, period_start, period_end, opening_balance, closing_balance,
     currency, filename, status, attachment_id, note, uploaded_by)
  values (v_no, acc.id, p_period_start, p_period_end, p_opening, p_closing,
          v_cur, btrim(p_filename), 'PENDING', p_attachment_id,
          nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into ops_acct.statement_lines
    (statement_id, line_no, value_date, direction, amount, amount_idr,
     raw_description, balance_after)
  select v_id, ord,
         (r ->> 'value_date')::date,
         (r ->> 'direction')::ops_acct.direction_t,
         (r ->> 'amount')::numeric,
         -- A rupiah line needs no conversion. A foreign one waits for a rate
         -- somebody types, because a guessed rate is a wrong number in the
         -- ledger and a right-looking one on the screen (D181).
         case when v_cur = 'IDR' then (r ->> 'amount')::numeric else null end,
         r ->> 'raw_description',
         nullif(r ->> 'balance_after','')::numeric
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord);

  perform ops_core.emit('accounting','accounting.statement.imported', v_no,
    jsonb_build_object('statement_no', v_no, 'account', acc.code,
                       'rows', n, 'period_start', p_period_start, 'period_end', p_period_end));

  res := ops_core.ok('accounting','bank_statement', v_no,'import',
    jsonb_build_object('statement_no', v_no, 'rows', n));
  return ops_core.idem_remember('accounting','import_statement', p_key, res);
end $$;

-- ── the four decisions about a line ───────────────────────────────────────

-- The rate for one foreign line. **Typed, never looked up** (D181): what the
-- bank actually gave on the day is on the advice, and a mid-market rate from
-- anywhere else is a different number that will not reconcile.
create or replace function ops_acct.set_statement_rate(
  p_line_id uuid, p_fx_rate numeric, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare l ops_acct.statement_lines; v_no text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('accounting','set_rate:' || coalesce(p_line_id::text,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','statement_line', p_line_id::text,'set_rate',
      'permission_required','Setting a rate belongs to Accounting.');
  end if;
  if p_fx_rate is null or p_fx_rate <= 0 then
    return ops_core.invalid('accounting','statement_line', p_line_id::text,'set_rate',
      'rate_invalid','A rate is a number greater than zero.',
      jsonb_build_object('field','fx_rate'));
  end if;

  select * into l from ops_acct.statement_lines where id = p_line_id;
  if not found then
    return ops_core.not_found('accounting','statement_line', p_line_id::text,'set_rate',
      'That line is not on any statement here.');
  end if;
  if l.status <> 'unmatched' then
    return ops_core.refused('accounting','statement_line', p_line_id::text,'set_rate',
      'line_decided','That line has already been decided. Its rate is part of what was decided.');
  end if;

  select statement_no into v_no from ops_acct.bank_statements where id = l.statement_id;

  update ops_acct.statement_lines
     set fx_rate = p_fx_rate, amount_idr = round(l.amount * p_fx_rate)
   where id = p_line_id;

  perform ops_core.emit('accounting','accounting.statement.rate_set', v_no,
    jsonb_build_object('line_id', p_line_id, 'fx_rate', p_fx_rate));

  res := ops_core.ok('accounting','statement_line', v_no,'set_rate',
    jsonb_build_object('line_id', p_line_id, 'amount_idr', round(l.amount * p_fx_rate)));
  return ops_core.idem_remember('accounting','set_rate:' || p_line_id::text, p_key, res);
end $$;

-- Saying that this line **is** a row the ledger already has.
--
-- The amounts have to agree within tolerance. A match that quietly accepts a
-- different figure is how a statement comes to "reconcile" against a ledger it
-- disagrees with — and this screen exists precisely to find that disagreement.
create or replace function ops_acct.match_statement_line(
  p_line_id uuid, p_trx_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare l ops_acct.statement_lines; t ops_acct.transactions; v_no text;
        res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('accounting','match:' || coalesce(p_line_id::text,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','statement_line', p_line_id::text,'match',
      'permission_required','Matching a statement line belongs to Accounting.');
  end if;

  select * into l from ops_acct.statement_lines where id = p_line_id;
  if not found then
    return ops_core.not_found('accounting','statement_line', p_line_id::text,'match',
      'That line is not on any statement here.');
  end if;
  if l.status <> 'unmatched' then
    return ops_core.noop('accounting','statement_line', l.trx_no,'match',
      'That line has already been decided.',
      jsonb_build_object('line_id', l.id, 'status', l.status, 'trx_no', l.trx_no));
  end if;
  if l.amount_idr is null then
    return ops_core.refused('accounting','statement_line', p_line_id::text,'match',
      'rate_required','A foreign line needs its rate before it can name a ledger row (D181).');
  end if;

  select * into t from ops_acct.transactions where trx_no = p_trx_no;
  if not found then
    return ops_core.not_found('accounting','statement_line', p_trx_no,'match',
      format('There is no transaction %s.', p_trx_no));
  end if;
  if t.status = 'VOID' then
    return ops_core.refused('accounting','statement_line', p_trx_no,'match',
      'transaction_void','That row was voided. A voided row did not move this money (A10).');
  end if;
  if t.direction <> l.direction then
    return ops_core.refused('accounting','statement_line', p_trx_no,'match',
      'direction_differs',
      format('The bank says %s and the ledger row says %s. One of the two is about different money.',
             l.direction, t.direction));
  end if;
  if abs(t.amount_idr - l.amount_idr) > ops_core.money_tolerance() then
    return ops_core.refused('accounting','statement_line', p_trx_no,'match',
      'amount_differs',
      format('The bank says %s and %s says %s. A match that accepts a different figure hides the disagreement this screen exists to find.',
             l.amount_idr, p_trx_no, t.amount_idr));
  end if;

  select statement_no into v_no from ops_acct.bank_statements where id = l.statement_id;

  update ops_acct.statement_lines
     set status = 'matched', trx_no = p_trx_no,
         decided_by = auth.uid(), decided_at = now()
   where id = p_line_id;

  perform ops_core.emit('accounting','accounting.statement.matched', v_no,
    jsonb_build_object('line_id', p_line_id, 'trx_no', p_trx_no));

  res := ops_core.ok('accounting','statement_line', v_no,'match',
    jsonb_build_object('line_id', p_line_id, 'trx_no', p_trx_no));
  return ops_core.idem_remember('accounting','match:' || p_line_id::text, p_key, res);
end $$;

-- Leaving a line out, **with a reason** (D182).
--
-- The constraint `ignored_has_reason` already refuses a blank one; this says
-- so in a sentence rather than a constraint violation. A line dropped with no
-- reason is indistinguishable from one nobody got to, and the difference
-- between those two is the whole value of the exception road.
create or replace function ops_acct.ignore_statement_line(
  p_line_id uuid, p_note text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare l ops_acct.statement_lines; v_no text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('accounting','ignore:' || coalesce(p_line_id::text,''), p_key);
  if replayed is not null then return replayed; end if;

  if not ops_core.has_permission('accounting.update') then
    return ops_core.refused('accounting','statement_line', p_line_id::text,'ignore',
      'permission_required','Leaving a line out belongs to Accounting.');
  end if;
  if coalesce(btrim(p_note), '') = '' then
    return ops_core.invalid('accounting','statement_line', p_line_id::text,'ignore',
      'reason_required',
      'A line left out needs a reason. Without one it cannot be told apart from a line nobody got to.',
      jsonb_build_object('field','note'));
  end if;

  select * into l from ops_acct.statement_lines where id = p_line_id;
  if not found then
    return ops_core.not_found('accounting','statement_line', p_line_id::text,'ignore',
      'That line is not on any statement here.');
  end if;
  if l.status <> 'unmatched' then
    return ops_core.noop('accounting','statement_line', l.trx_no,'ignore',
      'That line has already been decided.',
      jsonb_build_object('line_id', l.id, 'status', l.status));
  end if;

  select statement_no into v_no from ops_acct.bank_statements where id = l.statement_id;

  update ops_acct.statement_lines
     set status = 'ignored', note = btrim(p_note),
         decided_by = auth.uid(), decided_at = now()
   where id = p_line_id;

  perform ops_core.emit('accounting','accounting.statement.ignored', v_no,
    jsonb_build_object('line_id', p_line_id, 'note', btrim(p_note)));

  res := ops_core.ok('accounting','statement_line', v_no,'ignore',
    jsonb_build_object('line_id', p_line_id));
  return ops_core.idem_remember('accounting','ignore:' || p_line_id::text, p_key, res);
end $$;

-- Booking a line the ledger does not have yet.
--
-- This is the one that creates money, and it does **not** create it here: it
-- calls `post_transaction`, the one write seam for a ledger row (ADR-006). A
-- second road into the ledger is always the one somebody adds in a hurry and
-- always the one missing a check — so this function's job is to hand the line
-- over and record which row came back.
--
-- The statement itself is the evidence (D180): a bank's own record of the
-- movement is better than a screenshot of one, so the document this posts with
-- is the statement's attachment under `rekening_koran`.
create or replace function ops_acct.book_statement_line(
  p_line_id uuid,
  p_type_code text,
  p_description text,
  p_vendor_code text default null,
  p_project_code text default null,
  p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_acct, ops_core, pg_temp as $$
declare l ops_acct.statement_lines; s ops_acct.bank_statements; acc text;
        docs jsonb; posted jsonb; v_trx text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('accounting','book:' || coalesce(p_line_id::text,''), p_key);
  if replayed is not null then return replayed; end if;

  select * into l from ops_acct.statement_lines where id = p_line_id;
  if not found then
    return ops_core.not_found('accounting','statement_line', p_line_id::text,'book',
      'That line is not on any statement here.');
  end if;
  if l.status <> 'unmatched' then
    return ops_core.noop('accounting','statement_line', l.trx_no,'book',
      'That line has already been decided.',
      jsonb_build_object('line_id', l.id, 'status', l.status, 'trx_no', l.trx_no));
  end if;
  if l.amount_idr is null then
    return ops_core.refused('accounting','statement_line', p_line_id::text,'book',
      'rate_required','A foreign line needs its rate before it can reach the ledger (D181).');
  end if;

  select * into s from ops_acct.bank_statements where id = l.statement_id;
  select code into acc from ops_acct.accounts where id = s.account_id;

  -- **The statement is the evidence** (D180), so a statement nobody attached
  -- the file to has none to give. `post_transaction` would refuse this anyway
  -- — no document, no row (D85) — but it would refuse it in its own words,
  -- about notas and photographs, to somebody standing on the rekening koran
  -- screen whose actual problem is that the PDF was never uploaded. A refusal
  -- that does not name the next action is one people re-try rather than fix.
  if s.attachment_id is null then
    return ops_core.refused('accounting','statement_line', s.statement_no,'book',
      'statement_not_filed',
      format('%s has no file attached, and the statement is what evidences these movements. Attach the PDF the bank produced, then book its lines.',
             s.statement_no));
  end if;

  docs := case when s.attachment_id is null then '[]'::jsonb
               else jsonb_build_array(jsonb_build_object(
                      'attachment_id', s.attachment_id, 'kind','rekening_koran')) end;

  -- One seam for money, and this is not it. Whatever `post_transaction`
  -- refuses — no document, a purchase with no detail, the authority — is
  -- refused here unchanged, and handed back as it came.
  posted := ops_acct.post_transaction(
    p_account_code := acc,
    p_direction    := l.direction,
    p_amount       := l.amount_idr,
    p_type_code    := p_type_code,
    p_description  := p_description,
    p_documents    := docs,
    p_trx_date     := l.value_date,
    p_vendor_code  := p_vendor_code,
    p_project_code := p_project_code,
    p_remark       := l.raw_description,
    p_source_ref   := s.statement_no || ':' || l.line_no::text,
    p_key          := null);

  if posted ->> 'outcome' <> 'ok' then
    return posted;
  end if;

  v_trx := posted #>> '{data,trx_no}';

  update ops_acct.statement_lines
     set status = 'booked', trx_no = v_trx,
         decided_by = auth.uid(), decided_at = now()
   where id = p_line_id;

  perform ops_core.emit('accounting','accounting.statement.booked', s.statement_no,
    jsonb_build_object('line_id', p_line_id, 'trx_no', v_trx, 'amount', l.amount_idr));

  res := ops_core.ok('accounting','statement_line', s.statement_no,'book',
    jsonb_build_object('line_id', p_line_id, 'trx_no', v_trx));
  return ops_core.idem_remember('accounting','book:' || p_line_id::text, p_key, res);
end $$;

grant execute on function
  ops_acct.import_statement(text, date, date, numeric, numeric, text, text, jsonb, uuid, text, text),
  ops_acct.set_statement_rate(uuid, numeric, text),
  ops_acct.match_statement_line(uuid, text, text),
  ops_acct.ignore_statement_line(uuid, text, text),
  ops_acct.book_statement_line(uuid, text, text, text, text, text)
  to authenticated;
