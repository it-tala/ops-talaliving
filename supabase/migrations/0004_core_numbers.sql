-- 0004_core_numbers.sql — the database mints every identifier (ADR-005).
--
-- `pr-26-09-11_03`: prefix, office day, sequence within that day. Readable on
-- purpose — every cross-service reference in this system is one of these
-- strings, not a join (ADR-004), and a human has to be able to say it out loud
-- on the phone.
--
-- The counter is a row, taken with `on conflict do update`, so two requests at
-- the same moment cannot mint the same number. The demo's retry loop exists
-- only because a Map has no unique index.

create table ops_core.doc_numbers (
  prefix  text not null,
  day     date not null,
  seq     int  not null default 0,
  primary key (prefix, day)
);

-- WITA, and deliberately not `current_date`: the office day is not the
-- server's day, and a number minted at 08:05 Makassar must not carry
-- yesterday's date because UTC has not caught up (F17, F39).
create or replace function ops_core.office_day(at timestamptz default now())
returns date language sql immutable as $$
  select (at at time zone 'Asia/Makassar')::date
$$;

create or replace function ops_core.next_doc_number(p_prefix text, p_at timestamptz default now())
returns text
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  d date := ops_core.office_day(p_at);
  n int;
  width int := case when p_prefix = 'trx' then 3 else 2 end;
begin
  insert into ops_core.doc_numbers (prefix, day, seq)
       values (p_prefix, d, 1)
  on conflict (prefix, day)
    do update set seq = ops_core.doc_numbers.seq + 1
    returning seq into n;

  return p_prefix || '-' || to_char(d, 'YY-MM-DD') || '_' || lpad(n::text, width, '0');
end $$;

-- A document number is meant to be read out on the phone. A **token** is the
-- opposite: it identifies a request and must be unguessable, because whoever
-- holds it can answer that request (D69).
--
-- Two uuids rather than `gen_random_bytes`, which lives in pgcrypto. Supabase
-- ships pgcrypto and a bare Postgres does not, and a seam that only works on
-- one of them is a seam whose behaviour depends on where it is running —
-- exactly what the local harness exists to rule out. `gen_random_uuid()` has
-- been core since Postgres 13 and carries 122 bits of entropy; two of them is
-- past any argument.
create or replace function ops_core.new_token(p_prefix text default 'tok')
returns text language sql volatile as $$
  select p_prefix || '_'
      || replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '')
$$;

-- Every prefix in use, so an unknown one is caught here rather than appearing
-- in a document number nobody recognises.
create table ops_core.doc_prefixes (
  prefix text primary key,
  what   text not null
);

insert into ops_core.doc_prefixes (prefix, what) values
  ('pr',   'purchase request'),
  ('fund', 'payment round'),
  ('trx',  'ledger transaction'),
  ('pay',  'payment allocation'),
  ('po',   'purchase order'),
  ('ask',  'approval request'),
  ('pyr',  'payroll run'),
  ('spk',  'work order'),
  ('lbr',  'overtime sheet'),
  ('kyu',  'timber purchase'),
  -- A receiving report is a document somebody signs and files, so it gets a
  -- number like every other one. The demo minted `rcv-…` by hand; a prefix
  -- nobody has registered is a number nobody recognises, which is what this
  -- table exists to prevent.
  ('rcv',  'receiving report');

alter table ops_core.doc_numbers   enable row level security;
alter table ops_core.doc_prefixes  enable row level security;
create policy prefixes_read on ops_core.doc_prefixes for select to authenticated using (true);
-- No policy on doc_numbers: it is written only by the definer function above.

grant select on ops_core.doc_prefixes to authenticated;
grant execute on function ops_core.next_doc_number(text, timestamptz), ops_core.new_token(text)
  to authenticated;
