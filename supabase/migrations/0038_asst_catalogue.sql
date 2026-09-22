-- 0038_asst_catalogue.sql — John Lau's catalogue, moved out of the browser.
--
-- ── Where the boundary was, and why that is the wrong place ──────────────
--
-- `src/demo/assistant/catalogue.ts` says of itself, correctly:
--
--   *This file is the security boundary. Not a system prompt, not an
--    instruction to a model: a list the executor reads.*
--
-- It is also a TypeScript module, which means it is compiled into the bundle
-- every signed-in person downloads. Today that costs nothing, because the
-- executor reading it is in the same bundle and a person who edits their own
-- copy has only lied to themselves.
--
-- That stops being true the moment the assistant is real. A live John Lau runs
-- tools against PostgREST, and *which tools exist* would then be a fact the
-- caller supplies. `hr.payroll` is `reach: "blocked"` in a file the caller
-- owns; a caller who says it is `open` and asks the runner to proceed has
-- edited the security boundary from the devtools console.
--
-- So the list moves to where every other rule in this system already lives —
-- the database — and the browser's copy becomes what it should always have
-- been: a rendering of an answer, not the answer.
--
-- ── What `blocked` is, and what it is not ────────────────────────────────
--
-- `reach` is **a property of the tool, and no grant lifts it** (D218). It is
-- deliberately not a permission level, because a rule that can be granted away
-- is a default, and the owner's answer about Berkas 201 and the whole of IT
-- was not a default. The column is therefore consulted *before* anybody's
-- grants are, in `may_run` below, and the two refusals are different codes so
-- the screen can render them differently (F64):
--
--   `closed`      — nobody reaches this from a prompt. Asking IT does nothing.
--   `permission`  — this person may not. Asking IT is exactly the fix.
--
-- Rendering those the same way was the first version's mistake: a header
-- reading *tidak lewat prompt* over a permission problem sends somebody to
-- argue with the wrong person.
--
-- ── Both languages, resolved in two different places, on purpose ─────────
--
-- The **catalogue view carries both** and lets the screen pick, because that
-- list is a menu and a menu is rendering. The **refusal is resolved here**,
-- in `may_run`, because a refusal is a sentence the service is answerable for
-- and a Phase-2 HTTP client should receive it finished (D224/D225).
--
-- ── What is not here ─────────────────────────────────────────────────────
--
-- The turn store, the draft store and the router. Each one is a write path,
-- and a write path belongs in the migration that adds the thing that writes
-- it. This file adds the list and the gate over it, which is the half that has
-- to be right before anything else can be built on top.

create schema if not exists ops_asst;   -- John Lau: catalogue, turns, drafts

comment on schema ops_asst is
  'John Lau. The catalogue is the security boundary (D218); everything else here is a record '
  'of what was asked and answered. (0038)';

-- ── the three enums the catalogue is made of ─────────────────────────────

-- What a tool does to the world. `guide` touches nothing and returns steps;
-- it is a third thing rather than a kind of read, because a guide explains a
-- screen the person may not be able to open — and says so.
create type ops_asst.tool_effect_t as enum ('read','guide','write');

-- Why a tool is or is not reachable from a prompt at all. Two values, and the
-- second is not a level.
create type ops_asst.tool_reach_t as enum ('open','blocked');

-- Which kind of refusal came back, kept apart for the reason above.
create type ops_asst.refusal_t as enum ('closed','permission');

-- ── the catalogue ────────────────────────────────────────────────────────

create table ops_asst.tools (
  name              text primary key,
  -- Which module's grant the caller must hold, and how far it must reach.
  -- Null for guidance. This is the *same* question the screens ask
  -- (`requireModule`), asked against the same table, so an assistant can
  -- never act with rights the person typing does not have (D219).
  module            ops_core.module_t,
  level             ops_core.module_level_t not null default 'read',
  effect            ops_asst.tool_effect_t not null,
  reach             ops_asst.tool_reach_t not null default 'open',
  -- One line, in the words a person would use to ask for it.
  label_en          text not null,
  label_id          text not null,
  -- Shown verbatim when somebody asks for a blocked tool. A refusal that
  -- explains itself is worth more than a silent gap, and this is the sentence
  -- that has to survive being read by the person it disappointed.
  blocked_reason_en text,
  blocked_reason_id text,
  -- Where a person may do this instead. Required on a blocked tool: a refusal
  -- that names nowhere is a dead end, and A7 says a refusal names who can act.
  instead_at        text,
  -- The order the list is read in: reading, guidance, writing, then the
  -- refusals. Not alphabetical — the shape of the list is part of the answer
  -- to *what can I ask you*.
  sort_order        int not null unique,
  note              text,

  -- `admin` is not a level a tool may ask for. A tool that needed it would be
  -- a tool doing something administrative through a sentence, which is the
  -- thing `it.settings_write` is blocked for.
  constraint tool_level_sane check (level in ('read','write')),

  -- Guidance explains a screen; it does not read one, so it needs no grant.
  constraint guide_needs_no_grant
    check ((effect = 'guide') = (module is null)),

  -- A write tool that asked for `read` would be a write nobody had to be
  -- allowed to make.
  constraint write_needs_write
    check (effect <> 'write' or level = 'write'),

  -- Blocked means there is a reason, in both languages, and somewhere to go.
  constraint blocked_explains_itself
    check (
      case reach
        when 'blocked' then blocked_reason_en is not null
                        and blocked_reason_id is not null
                        and instead_at is not null
        when 'open'    then blocked_reason_en is null
                        and blocked_reason_id is null
      end)
);

comment on table ops_asst.tools is
  'Everything John Lau can be asked to do, and everything it cannot. The blocked rows are here '
  'on purpose: a capability that is missing teaches people to rephrase until something works, '
  'and one that is present and refused ends the conversation honestly. (0038)';

comment on column ops_asst.tools.reach is
  'A property of the tool, not a permission level. No grant lifts `blocked` — that is the whole '
  'of D218, and `may_run` reads this column before it reads anybody''s grants. (0038)';

-- ── what the owner decided, as rows ──────────────────────────────────────
--
-- Transcribed from `src/demo/assistant/catalogue.ts`, wording included. The
-- five blocked entries and their reasons are the owner's answers, not
-- defaults, and they are copied rather than paraphrased for that reason.

insert into ops_asst.tools
  (sort_order, name, module, level, effect, reach, label_en, label_id,
   blocked_reason_en, blocked_reason_id, instead_at) values

/* ── reading ──────────────────────────────────────────────────────────── */
 (10,'procurement.pending_approvals','procurement','read','read','open',
     'Request lines waiting for approval',
     'Baris permintaan yang menunggu persetujuan',
     null,null,'/procurement/meeting'),
 (11,'procurement.vendor_debt','procurement','read','read','open',
     'What we still owe a vendor',
     'Berapa yang masih kita hutang ke sebuah vendor',
     null,null,'/procurement/tracker'),
 (12,'accounting.balances','accounting','read','read','open',
     'Balance of each account',
     'Saldo tiap rekening',
     null,null,'/accounting/ledger'),
 (13,'inventory.low_stock','inventory','read','read','open',
     'Items already below their minimum',
     'Barang yang sudah di bawah stok minimum',
     null,null,'/inventory/material'),
 (14,'production.late_orders','production','read','read','open',
     'Work orders past their promised date',
     'SPK yang lewat tanggal janji',
     null,null,'/produksi/jadwal'),
 (15,'delivery.fulfilment','project','read','read','open',
     'How much of a client order has arrived and been fitted',
     'Sudah berapa banyak pesanan klien yang sampai dan terpasang',
     null,null,'/proyek/serah-terima'),

/* ── guidance ─────────────────────────────────────────────────────────── */
 (20,'guide.create_po',null,'read','guide','open',
     'How to create a purchase order',
     'Cara membuat purchase order',
     null,null,'/procurement/po'),
 (21,'guide.receive_goods',null,'read','guide','open',
     'How to record goods arriving',
     'Cara mencatat barang datang',
     null,null,'/procurement/penerimaan'),
 (22,'guide.pay_line',null,'read','guide','open',
     'How to pay a request line',
     'Cara membayar sebuah baris permintaan',
     null,null,'/procurement/tracker'),

/* ── writing, and only ever as a draft ────────────────────────────────── */
 (30,'procurement.draft_pr_line','procurement','write','write','open',
     'Draft a new purchase request line',
     'Menyiapkan baris permintaan pembelian baru',
     null,null,'/procurement/pr/new'),
 (31,'procurement.draft_po','procurement','write','write','open',
     'Draft a new purchase order',
     'Menyiapkan purchase order baru',
     null,null,'/procurement/po'),

/* ── never, at any grant ──────────────────────────────────────────────── */
 (40,'hr.employee_files','hrd','read','read','blocked',
     'Employee files — ID card, family card, contract, tax and insurance numbers',
     'Berkas 201 — KTP, kartu keluarga, kontrak, NPWP, BPJS',
     $r$Employee files cannot be read through the prompt, at any level of access. Identity numbers are opened one at a time by a person, with an eye button, and every opening is recorded in the audit trail under that person's name (D196). A conversation cannot carry that trail: it can copy, forward, and answer ten numbers at once.$r$,
     $r$Berkas 201 tidak bisa dibaca lewat prompt, pada tingkat akses mana pun. Nomor identitas dibuka satu per satu oleh orang, dengan tombol mata, dan setiap pembukaan tercatat atas nama orang itu di audit (D196). Percakapan tidak bisa memberikan jejak itu: ia bisa menyalin, meneruskan, dan menjawab sepuluh nomor sekaligus.$r$,
     '/hrd/berkas-201'),
 (41,'hr.payroll','payroll','read','read','blocked',
     'Salaries, payslips, pay adjustments',
     'Gaji, slip gaji, penyesuaian upah',
     $r$Individual pay is not read through the prompt. Confirmed by the owner after it was proposed as a default: one person's salary is the same class of exposure as their ID number, and it is far easier to ask for everybody's at once.$r$,
     $r$Gaji per orang tidak dibaca lewat prompt. Dikonfirmasi pemilik setelah diusulkan sebagai default: nominal gaji satu orang adalah paparan sejenis dengan nomor KTP, dan jauh lebih mudah dimintakan sekaligus untuk semua orang.$r$,
     '/hrd/payroll'),
 (42,'hr.attendance','hrd','read','read','blocked',
     'Attendance and lateness per person',
     'Absensi dan keterlambatan per orang',
     $r$Attendance per person is not read through the prompt, for the same reason as pay: easy to ask for wholesale, and what comes out is a record about people rather than about the company. Confirmed by the owner.$r$,
     $r$Kehadiran per orang tidak dibaca lewat prompt, alasan yang sama dengan gaji: mudah diminta sekaligus, dan yang keluar adalah catatan tentang orang, bukan tentang perusahaan. Dikonfirmasi pemilik.$r$,
     '/hrd/absensi'),
 (43,'it.audit','it','read','read','blocked',
     'Audit log, activity log, users, roles',
     'Audit log, log aktivitas, pengguna, peran',
     $r$The IT module cannot be read through the prompt at all (owner). The audit trail is a record of what people did; reading it through a conversation turns it into a way to watch a colleague with one sentence. Only IT and leadership may open it, on its own screen (D190).$r$,
     $r$Modul IT tidak bisa dibaca lewat prompt sama sekali (pemilik). Jejak audit adalah catatan tentang apa yang dilakukan orang; membacanya lewat percakapan menjadikannya alat untuk mengawasi rekan kerja dengan satu kalimat. Yang boleh membukanya hanya IT dan pimpinan, di layarnya sendiri (D190).$r$,
     '/it/audit'),
 (44,'it.settings_write','settings','write','write','blocked',
     'Change system settings',
     'Mengubah pengaturan sistem',
     $r$Settings are not changed through the prompt. Five of the twelve rewrite figures that already exist (D214), and the difference between the safe ones and the rest is exactly what a sentence loses — on the screen that difference is the first thing you read.$r$,
     $r$Pengaturan tidak diubah lewat prompt. Lima dari dua belas pengaturan mengubah angka yang sudah ada (D214), dan perbedaan antara yang aman dan yang tidak justru hilang dalam kalimat percakapan — di layarnya perbedaan itu yang pertama terbaca.$r$,
     '/pengaturan');

-- ── who may read it, and who may change it ───────────────────────────────
--
-- **Everybody reads it, including the blocked rows.** That is the point: the
-- refusal is a feature of the catalogue rather than a gap in it, and somebody
-- who cannot see that `hr.payroll` exists-and-is-refused will keep rephrasing
-- until they find a way in.
--
-- **Nobody writes it through the API — not IT, not the owner.** There is no
-- insert, update or delete policy on this table and no grant for one, so every
-- change is a migration: reviewed, in the history, next to the reason. A
-- security boundary that an admin screen can edit is a security boundary one
-- compromised admin session can edit, and this one holds decisions the owner
-- made once and should not have to defend again at 7pm.
alter table ops_asst.tools enable row level security;

create policy tools_read on ops_asst.tools
  for select to authenticated using (true);

grant usage on schema ops_asst to authenticated;
grant select on ops_asst.tools to authenticated;

-- ── does this person hold the grant ──────────────────────────────────────

/* The same question the screens ask, asked against the same table.
 *
 * `module_level_t` is ordered `read < write < admin`, so `>=` is the whole
 * check: somebody with `procurement.admin` may run a tool that asks for
 * `procurement.write`, exactly as they may open the screen that does it.
 *
 * `security definer` because a policy-free read of `user_modules` is not
 * something an ordinary caller has, and `stable` so it is evaluated once per
 * statement rather than once per row of the catalogue.
 */
create or replace function ops_asst.holds_grant(
  p_module ops_core.module_t,
  p_level ops_core.module_level_t)
returns boolean
language sql stable security definer set search_path = ops_asst, ops_core, pg_temp as $$
  select p_module is null or exists (
    select 1 from ops_core.user_modules g
     where g.user_id = auth.uid()
       and g.module  = p_module
       and g.level  >= p_level)
$$;

grant execute on function ops_asst.holds_grant(ops_core.module_t, ops_core.module_level_t)
  to authenticated;

-- ── the catalogue, as this person sees it ────────────────────────────────

/* Both languages, because this is a menu and a menu is rendering.
 *
 * `may` is the derived part and has three values rather than two, for the
 * reason the whole file is about:
 *
 *   `blocked`    — nobody, ever. The reason is in the row.
 *   `no_grant`   — reachable, and not by you. IT can fix this.
 *   `yes`        — go ahead.
 *
 * Derived on every read, never stored (A3): a grant added this morning is
 * visible this morning, and a column saying otherwise would be a stale answer
 * about permissions, which is the worst kind.
 */
create or replace view ops_asst.v_tool_catalogue as
  select t.name, t.module, t.level, t.effect, t.reach,
         t.label_en, t.label_id,
         t.blocked_reason_en, t.blocked_reason_id,
         t.instead_at, t.sort_order,
         case
           when t.reach = 'blocked' then 'blocked'
           when ops_asst.holds_grant(t.module, t.level) then 'yes'
           else 'no_grant'
         end as may
    from ops_asst.tools t
   order by t.sort_order;

alter view ops_asst.v_tool_catalogue set (security_invoker = on);
grant select on ops_asst.v_tool_catalogue to authenticated;

comment on view ops_asst.v_tool_catalogue is
  'The catalogue with, per row, whether this person may run it — three values, because '
  '*nobody ever* and *not you* have different fixes and rendering them alike sends somebody to '
  'argue with the wrong person (F64). (0038)';

-- ── the gate ─────────────────────────────────────────────────────────────

/* **Every tool call passes through here first.**
 *
 * The order of the three questions is the security design, so it is written
 * out rather than implied:
 *
 *   1. Does the tool exist at all? An unknown name is not a refusal — it is
 *      *I do not know that one*, and answering it as a permission problem
 *      would tell a prober that the name was real.
 *   2. Is it reachable from a prompt? Asked **before** grants, because no
 *      grant lifts it and asking the other way round would make `blocked`
 *      look like a level somebody could be given (D218).
 *   3. Does this person hold the grant? The same question the screen asks
 *      (D219).
 *
 * The refusal is resolved into one language here rather than at the screen:
 * it is a sentence this service is answerable for, and a Phase-2 HTTP client
 * should receive it finished (D224).
 *
 * It writes an audit row on every answer, including yes. That is the whole
 * value of routing tool calls through one function: *who asked John Lau for
 * what, and what did it say back* becomes a question with an answer, and the
 * refusals — which are the rows that matter — are in the same trail as
 * everything else rather than in a log nobody reads.
 */
create or replace function ops_asst.may_run(p_name text, p_lang text default 'id')
returns jsonb
language plpgsql security definer set search_path = ops_asst, ops_core, pg_temp as $$
declare t ops_asst.tools; v_reason text; v_lang text;
begin
  v_lang := case when lower(coalesce(p_lang,'id')) = 'en' then 'en' else 'id' end;

  select * into t from ops_asst.tools where name = p_name;
  if not found then
    -- Deliberately `not_found` and not `refused`: John Lau not knowing a name
    -- is an honest *saya tidak mengerti*, and a 403 here would confirm to
    -- somebody guessing names that this one was real.
    return ops_core.not_found('assistant','tool', p_name,'run',
      case v_lang when 'en' then format('There is no tool called %s.', p_name)
                  else format('Tidak ada alat bernama %s.', p_name) end);
  end if;

  if t.reach = 'blocked' then
    v_reason := case v_lang when 'en' then t.blocked_reason_en else t.blocked_reason_id end;
    return ops_core.refused('assistant','tool', t.name,'run',
      'closed', v_reason,
      jsonb_build_object('refused_because','closed','instead_at', t.instead_at,
                         'module', t.module));
  end if;

  if not ops_asst.holds_grant(t.module, t.level) then
    return ops_core.refused('assistant','tool', t.name,'run',
      'permission_required',
      case
        -- Two different sentences, because they are two different situations:
        -- no grant at all, and a grant that does not reach far enough. Telling
        -- somebody they lack *read access* when they have none is how a person
        -- ends up asking IT for something they already have.
        when t.level = 'read' then
          case v_lang
            when 'en' then format('You do not have access to the %s screens. IT can give you that.', t.module)
            else format('Anda belum punya akses ke modul %s. IT yang bisa memberikannya.', t.module) end
        else
          case v_lang
            when 'en' then format('This one writes, and your access to %s is read-only. IT can give you write access.', t.module)
            else format('Yang ini menulis, sedangkan akses Anda di modul %s baru sebatas melihat. IT yang bisa menaikkannya.', t.module) end
      end,
      jsonb_build_object('refused_because','permission','instead_at', t.instead_at,
                         'module', t.module, 'level', t.level));
  end if;

  return ops_core.ok('assistant','tool', t.name,'run',
    jsonb_build_object('name', t.name, 'effect', t.effect, 'module', t.module,
                       'level', t.level, 'instead_at', t.instead_at,
                       'label', case v_lang when 'en' then t.label_en else t.label_id end));
end $$;

grant execute on function ops_asst.may_run(text, text) to authenticated;

comment on function ops_asst.may_run(text, text) is
  'The one gate every tool call passes. Asks reach before grants, because no grant lifts '
  '`blocked` (D218), and answers the two refusals with different codes because they have '
  'different fixes (F64). (0038)';
