-- 0126 — what John Lau knows about how this system is used.
--
-- ── why a table, when the three guides are a TypeScript file ─────────────
--
-- `src/lib/john-lau.ts` holds three guides as prose, and says why: a guide
-- explains a screen, touches nothing, and belongs beside the other sentences
-- the shell says. That was right while the only reader was a keyword match
-- that picked one guide whole.
--
-- The reader now is a language model (D296), and it needs something different:
-- **every** process, in order, with the screen each step happens on, the
-- status it moves a document from and to, the rule behind it, and the
-- questions people actually asked about it — so that *saya sudah bikin PR,
-- terus apa?* can be answered from where the person is. That is structured
-- knowledge, it grows one process at a time as each module is walked, and IT
-- should be able to read it without reading code. So it is rows.
--
-- ── what it is not ─────────────────────────────────────────────────────────
--
-- **Not business data.** Nothing here names a vendor, an amount or a person;
-- it describes how the screens work. That is what makes it safe to hand to a
-- model whole, and what keeps D218 true with a model in the loop: the model is
-- given this and the person's own turns, never a row of anything else.
--
-- **Not a security boundary.** `ops_asst.tools` is (0038), and a guide still
-- opens nothing: the permission named on a process is the one the screen will
-- ask for, stated so the model can say *you will need X* rather than let
-- somebody discover it at the button.
--
-- ── how it is written ─────────────────────────────────────────────────────
--
-- In Indonesian, because the SOP it is written from is Indonesian and the
-- people reading it are; the model answers in the person's language either
-- way. Each process was walked end to end against this ladder before it was
-- written down (`supabase/local/smoke/99_sim_procure_to_ledger.sql`), so a
-- status named here is a status the database actually sets.
--
-- Rows change by migration, like the router rules' seed did (0039), so a
-- wrong instruction is a reviewable diff and not an edit nobody can trace.

create table ops_asst.processes (
  key         text primary key check (key ~ '^[a-z]+\.[a-z_]+$'),
  module      text not null,
  -- The order of the whole flow across modules: PR before PO before payment.
  seq         int  not null,
  title       text not null,
  -- Why this process exists, in one or two sentences. The first thing a model
  -- should say when somebody asks *buat apa ini*.
  purpose     text not null,
  -- The screen it starts on.
  route       text not null check (route like '/%'),
  -- The permission the screen asks for, as `ops_core.permission_catalog`
  -- spells it. Null means anybody signed in.
  permission  text,
  -- What normally comes before it, so *terus apa?* has an answer.
  follows     text references ops_asst.processes(key),
  -- Screenshot folder in `docs/sop/`, for the SOP document built from the same
  -- walk.
  sop_ref     text
);

create table ops_asst.process_steps (
  process_key   text not null references ops_asst.processes(key) on delete cascade,
  seq           int  not null check (seq > 0),
  route         text check (route like '/%'),
  -- The click, as the screen labels it.
  action        text not null,
  -- The reason behind it — *the rule and then the click* (D222).
  rule          text,
  -- Document status before and after this step, verbatim as the database
  -- stores it. Null where the step moves nothing.
  status_before text,
  status_after  text,
  -- Which seam does the work, for IT and for the model to name when asked
  -- *di mana tercatatnya*. Function names, never table contents.
  writes        text[] not null default '{}',
  screenshot    text,
  primary key (process_key, seq)
);

create table ops_asst.process_faq (
  id          int generated always as identity primary key,
  process_key text not null references ops_asst.processes(key) on delete cascade,
  question    text not null,
  answer      text not null,
  unique (process_key, question)
);

create index process_steps_route_idx on ops_asst.process_steps (route);

-- Readable by anybody signed in, writable by nobody through the API: the rows
-- arrive by migration. Knowing how the PO screen works is not a privilege —
-- being able to open it is, and that is decided where it always was.
alter table ops_asst.processes     enable row level security;
alter table ops_asst.process_steps enable row level security;
alter table ops_asst.process_faq   enable row level security;

create policy processes_read     on ops_asst.processes     for select to authenticated using (true);
create policy process_steps_read on ops_asst.process_steps for select to authenticated using (true);
create policy process_faq_read   on ops_asst.process_faq   for select to authenticated using (true);

grant select on ops_asst.processes, ops_asst.process_steps, ops_asst.process_faq to authenticated;

comment on table ops_asst.processes is
  'How the system is used, one business process per row, walked before it was written. Read by '
  'John Lau''s model and by the SOP; never business data. (0126, D296)';
comment on table ops_asst.process_steps is
  'The steps of a process: screen, click, the rule behind it, and the status it moves. (0126)';
comment on table ops_asst.process_faq is
  'Questions people asked about a process, with the answer. (0126)';
