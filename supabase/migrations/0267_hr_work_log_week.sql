-- 0267 — laporan harian seperti lembar kerja: item jangka panjang, isi mundur
-- dan ke depan, ringkasan per minggu (D428).
--
-- ── the ask ────────────────────────────────────────────────────────────────
--
-- Owner, 2026-10-12, holding up the personal work-plan sheet IT has kept since
-- July (rows = *major items*, columns = a week summary then Senin–Minggu, one
-- free-text cell per item per day):
--
--   *evaluasi log harian yang ada di ops supaya bisa sama dengan yang di
--    spreadsheet* — and, on the four questions asked:
--   1. *bebas tapi jadi dropdown pilihan untuk tugas jangka panjang*
--   2. ringkasan minggu *ditulis sendiri*
--   3. minggu mulai *senin*
--   4. *boleh isi mundur dan isi ke depan untuk personal planning mereka*
--
-- ── what changes ───────────────────────────────────────────────────────────
--
--   • **Item jangka panjang** (`work_items`): a person's own rows, named in
--     their own words (*John Lau V0.1 – Monorepo*, *Google Workspace*), kept as
--     a list and picked from the same dropdown as tasks and *dadakan*. Status
--     `aktif` / `selesai` / `dihentikan` is the sheet's *Done* / *Deprecated*.
--     A log line is now for a task, for an item, or dadakan — one of the three.
--     An item is the person's own planned work, so it is **not** dadakan and
--     needs no *diminta oleh*.
--
--   • **Any day, not only today** (reverses D371's *today only*, by the
--     owner's word). A line can be written, changed or removed for a past day
--     or a coming one — the coming ones are the person's plan. The window is
--     a setting (`hr.work_log_window_days`, 366) so a typo of a year is caught.
--
--     D372's worry stays true: a log written the night before a review is
--     weaker evidence. So instead of forbidding it, the record **says** it:
--     `v_work_log.written_on` is the office day a line was first written, and
--     the review's evidence counts lines written after their day and lines
--     written ahead of it. And a day only counts as *logged* for the KPI if
--     some line for it was written or touched **on or after** that day — a
--     plan nobody came back to is a plan, not a report (`daily_log_coverage`).
--
--   • **Ringkasan minggu** (`work_week_notes`): one free-text summary per
--     person, per week (Monday start), per row — an item, a task, or the
--     *dadakan / lainnya* row. Written only by the person, any week. Clearing
--     sets it null; the seam holds no DELETE (F218).
--
--   • **`work_week()`**: the calendar the grid is drawn on — seven days from a
--     Monday, each with whether the person works it, the office holiday and
--     the person's own mark — and the week's summaries. The lines themselves
--     come from `v_work_log` as before.
--
-- HRD still cannot write anybody's log, item or summary: there is no
-- parameter that names a person on any write seam here.

insert into ops_core.settings (key, value, note) values
  ('hr.work_log_window_days', '366'::jsonb,
   'How many days back and ahead of today a daily-log line may be dated (D428).');

/* ── item jangka panjang ─────────────────────────────────────────────────── */
create table ops_hr.work_items (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references ops_hr.employees(id),
  title       text not null check (length(btrim(title)) between 1 and 120),
  status      text not null default 'aktif' check (status in ('aktif','selesai','dihentikan')),
  created_by  uuid not null references ops_core.users(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  constraint work_item_close_is_dated check ((status = 'aktif') = (closed_at is null))
);

create unique index work_items_title_once on ops_hr.work_items (employee_id, lower(btrim(title)));

alter table ops_hr.work_items enable row level security;

comment on table ops_hr.work_items is
  'A person''s own long-running rows of the daily log — the sheet''s major items (D428).';

create policy work_items_read on ops_hr.work_items for select to authenticated
  using (ops_core.has_permission('hrd.read')
         or ops_core.has_permission('payroll.read')
         or employee_id = ops_hr.my_employee_id());
grant select on ops_hr.work_items to authenticated;

/* ── a line is for a task, an item, or dadakan ──────────────────────────── */
alter table ops_hr.work_log add column item_id uuid references ops_hr.work_items(id);

alter table ops_hr.work_log drop constraint dadakan_names_who_asked;
alter table ops_hr.work_log add constraint dadakan_names_who_asked check (
  task_id is not null or item_id is not null
  or (requested_by is not null and length(btrim(requested_by)) > 0));
alter table ops_hr.work_log add constraint task_or_item check (task_id is null or item_id is null);
alter table ops_hr.work_log drop constraint promotion_is_dadakan;
alter table ops_hr.work_log add constraint promotion_is_dadakan check (
  promoted_task_id is null or (task_id is null and item_id is null));

create unique index work_log_item_once_a_day on ops_hr.work_log (employee_id, work_date, item_id)
  where item_id is not null;

/* `editable` is now any day, but only the writer's own line: the view is read
   by HRD too, and a button HRD cannot use is a button that lies. New columns
   go at the end, so `create or replace` keeps the old ones in place. */
create or replace view ops_hr.v_work_log as
select
  w.id, w.work_date, w.employee_id,
  e.employee_no, e.full_name as employee_name,
  case when w.task_id is not null then 'tugas'
       when w.item_id is not null then 'item'
       else 'dadakan' end as kind,
  t.task_no, t.title as task_title, t.status as task_status,
  g.goal_no, g.title as goal_title, g.rank as goal_rank,
  w.summary, w.progress, w.requested_by, w.hours,
  w.created_at, w.updated_at,
  (w.promoted_task_id is null and w.employee_id = ops_hr.my_employee_id()) as editable,
  pt.task_no as promoted_task_no,
  w.item_id, i.title as item_title, i.status as item_status,
  ops_core.office_day(w.created_at) as written_on
from ops_hr.work_log w
join ops_hr.employees e on e.id = w.employee_id
left join ops_hr.tasks t on t.id = w.task_id
left join ops_hr.goals g on g.id = t.goal_id
left join ops_hr.tasks pt on pt.id = w.promoted_task_id
left join ops_hr.work_items i on i.id = w.item_id;

/* `create or replace` resets the view's options: put RLS back (smoke 17). */
alter view ops_hr.v_work_log set (security_invoker = on);

/* Items as the dropdown and the grid read them: how much each has been used. */
create view ops_hr.v_work_items as
select i.id, i.employee_id, e.employee_no, i.title, i.status, i.created_at, i.closed_at,
       (select count(*)::int from ops_hr.work_log l where l.item_id = i.id) as entries,
       (select max(l.work_date) from ops_hr.work_log l where l.item_id = i.id) as last_date
  from ops_hr.work_items i
  join ops_hr.employees e on e.id = i.employee_id;

alter view ops_hr.v_work_items set (security_invoker = on);
grant select on ops_hr.v_work_items to authenticated;

/* ── ringkasan minggu ───────────────────────────────────────────────────── */
create table ops_hr.work_week_notes (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references ops_hr.employees(id),
  week_start  date not null check (extract(isodow from week_start) = 1),
  /* Both null is the *dadakan / lainnya* row. */
  item_id     uuid references ops_hr.work_items(id),
  task_id     uuid references ops_hr.tasks(id),
  summary     text check (summary is null or length(btrim(summary)) > 0),
  updated_by  uuid not null references ops_core.users(id),
  updated_at  timestamptz not null default now(),
  constraint week_note_one_row check (item_id is null or task_id is null)
);

create unique index work_week_notes_once on ops_hr.work_week_notes
  (employee_id, week_start, coalesce(item_id, task_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table ops_hr.work_week_notes enable row level security;

comment on table ops_hr.work_week_notes is
  'Ringkasan minggu: the person''s own summary of a week, per row of the daily log (D428).';

create policy work_week_notes_read on ops_hr.work_week_notes for select to authenticated
  using (ops_core.has_permission('hrd.read')
         or ops_core.has_permission('payroll.read')
         or employee_id = ops_hr.my_employee_id());
grant select on ops_hr.work_week_notes to authenticated;

/* ── a day counts as logged once it has been reported on, not only planned ─
 *
 *  `0214`'s body, with one change: the line must have been written or last
 *  touched on or after its own day. A line written ahead is a plan; coming
 *  back to it on the day (or later) is what makes it a report.
 */
create or replace function ops_hr.daily_log_coverage(p_employee uuid, p_from date, p_to date)
returns table (expected int, logged int, counted_from date, counted_to date)
language plpgsql stable set search_path = ops_hr, ops_core, pg_temp as $$
declare v_from date; v_to date; emp ops_hr.employees%rowtype;
begin
  v_from := greatest(p_from, coalesce(
    (select (value #>> '{}')::date from ops_core.settings where key = 'kpi.daily_log_from'),
    date '2026-10-06'));
  v_to := least(p_to, ops_core.office_day() - 1);
  counted_from := v_from;
  counted_to := v_to;
  select * into emp from ops_hr.employees where id = p_employee;
  if not found or v_to < v_from then
    expected := 0; logged := 0;
    return next;
    return;
  end if;
  select count(*)::int,
         count(*) filter (where exists (
           select 1 from ops_hr.work_log l
            where l.employee_id = p_employee and l.work_date = d.work_date
              and ops_core.office_day(coalesce(l.updated_at, l.created_at)) >= l.work_date))::int
    into expected, logged
    from ops_hr.timesheet(p_employee, v_from, v_to) d
   where not ops_hr.is_rest_day(ops_hr.rules_on(d.work_date), d.work_date)
     and not coalesce((ops_hr.schedule_day(ops_hr.pattern_on(emp.schedule_code, emp.unit, d.work_date),
                                           d.work_date) ->> 'off')::boolean, false)
     and (d.mark_kind is null or d.mark_kind = 'half_day');
  return next;
end $$;

/* ── the KPI's dadakan note: an item line is planned work, not dadakan ─────
 *
 *  `0214`'s body; the only change is the dadakan filter.
 */
create or replace function ops_hr.kpi(p_employee uuid, p_from date, p_to date)
returns ops_hr.kpi_card_t
language plpgsql stable set search_path = ops_hr, pg_temp as $$
declare
  emp       ops_hr.employees%rowtype;
  c         ops_hr.kpi_card_t;
  n_meas    int; total_w numeric; weighted numeric; min_meas int;
  w         text[] := '{}';
  v_tapped  int;
  a_emp int; a_team int; a_unknown int; a_all int;
  n_log int; n_dadakan int;
begin
  select * into emp from ops_hr.employees where id = p_employee;
  if not found then return null; end if;
  min_meas := coalesce(ops_core.setting_num('kpi.min_measures'), 2)::int;

  c.employee_id := emp.id; c.employee_no := emp.employee_no; c.full_name := emp.full_name;
  c.period_start := p_from; c.period_end := p_to;

  select count(*),
         count(*) filter (where value is not null),
         coalesce(sum(weight) filter (where value is not null), 0),
         coalesce(sum(value * weight) filter (where value is not null), 0)
    into c.measure_count, n_meas, total_w, weighted
    from ops_hr.kpi_measures(p_employee, p_from, p_to);
  c.measured_count := n_meas;

  /* A score over one axis out of three is that one axis wearing a costume. */
  if n_meas < min_meas or total_w = 0 then
    c.score := null;
    c.score_reason := format(
      'Baru %s dari %s ukuran yang bisa dihitung; nilai gabungan baru ditampilkan mulai %s. Angka gabungan dari satu ukuran hanya ukuran itu sendiri dengan nama lain.',
      n_meas, c.measure_count, min_meas);
  else
    c.score := round(weighted / total_w)::int;
    c.score_reason := null;
  end if;

  select coalesce(sum(d.overtime_hours), 0), count(*) filter (where d.in_at is not null and d.mark_kind is null)
    into c.overtime_hours, v_tapped
    from ops_hr.timesheet(p_employee, p_from, p_to) d;
  c.overtime_hours := round(c.overtime_hours, 1);

  select count(*) filter (where status = 'OPEN'),
         count(*) filter (where status = 'OPEN' and blocked_reason is not null)
    into c.tasks_open, c.tasks_blocked
    from ops_hr.tasks where assignee_id = p_employee;

  /* Production work is **shown, attributed, and deliberately not scored**
     (D264). A piece is not a unit: eight nakas and four wardrobes do not add
     up, and dividing them by anything produces a number that looks like a
     performance figure and is not one.

     Coverage is a property of the **record**, not of the person: nobody can
     tell whether an unresolved entry belongs to somebody, so an empty column
     reads as *this person made nothing* when the truth is *nobody wrote down
     who made it*. Every card carries the period's coverage beside the
     figure. */
  select coalesce(sum(e.qty) filter (where e.worked_by_employee_id = p_employee), 0)
    into c.work_pieces
    from ops_prod.progress_entries e
   where e.work_date between p_from and p_to and e.qty > 0;

  select count(*), count(*) filter (where worked_by_employee_id is not null),
         count(*) filter (where worked_by_not_a_person),
         count(*) filter (where worked_by_employee_id is null and not worked_by_not_a_person)
    into a_all, a_emp, a_team, a_unknown
    from ops_prod.progress_entries
   where work_date between p_from and p_to and qty > 0;
  c.work_unknown := a_unknown;
  c.work_coverage := case when a_all = 0 then null
                          else round((a_emp + a_team)::numeric / a_all * 100)::int end;

  if v_tapped = 0 then
    w := w || 'Tidak ada data absensi mesin untuk orang ini pada periode ini.'::text;
  end if;
  if c.tasks_blocked > 0 then
    w := w || format('%s tugas tertahan menunggu pihak lain — tidak dihitung sebagai kegagalan orang ini.', c.tasks_blocked);
  end if;
  if c.work_pieces = 0 and a_unknown > 0 then
    w := w || format('Tidak ada pekerjaan produksi yang tertaut ke orang ini — dan %s entri periode ini masih atas nama yang belum ditautkan, jadi kosong di sini belum tentu berarti tidak mengerjakan apa pun.', a_unknown);
  elsif c.work_pieces = 0 then
    w := w || 'Tidak ada pekerjaan produksi atas nama orang ini pada periode ini.'::text;
  else
    w := w || 'Hasil produksi ditampilkan sebagai bukti, bukan sebagai nilai: satu lemari dan satu nakas tidak bisa dijumlahkan, jadi jumlah potong bukan ukuran kinerja.'::text;
  end if;
  /* The share of unplanned work, as context and never as a score (D371): an
     interrupted person is not a worse employee, and the figure is what lets a
     reader see that the priorities leaked rather than that the person did. */
  select count(*), count(*) filter (where l.task_id is null and l.item_id is null)
    into n_log, n_dadakan
    from ops_hr.work_log l
   where l.employee_id = p_employee and l.work_date between p_from and p_to;
  if n_log > 0 then
    w := w || format('%s dari %s entri laporan harian adalah pekerjaan dadakan — dibaca sebagai konteks, tidak dinilai.',
                     n_dadakan, n_log);
  end if;
  c.notes := w;

  return c;
end $$;

/* ── writing a line, for any day in the window ─────────────────────────────
 *
 *  `0214`'s seam with two new arguments at the end, so a call written for it
 *  still means the same thing: `p_item` (one of the person's own items) and
 *  `p_work_date` (null = today, or the line's own day when changing it).
 *  The person is still `my_employee_id()` and nothing else.
 */
drop function ops_hr.log_work(text, text, text, text, numeric, uuid);

create or replace function ops_hr.log_work(
  p_summary text, p_progress text,
  p_task_no text default null, p_requested_by text default null,
  p_hours numeric default null, p_entry uuid default null,
  p_item uuid default null, p_work_date date default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_me uuid := ops_hr.my_employee_id();
  v_today date := ops_core.office_day();
  v_window int;
  t ops_hr.tasks%rowtype; it ops_hr.work_items%rowtype; w ops_hr.work_log%rowtype;
  v_task uuid; v_item uuid; v_asker text; v_id uuid; v_day date;
begin
  if v_me is null then
    return ops_core.refused('hr','work_log', null, 'log','no_employee_link',
      'Akun ini belum tertaut ke data karyawan, jadi tidak bisa mengisi laporan harian. Minta HRD menautkannya.');
  end if;

  if p_entry is not null then
    select * into w from ops_hr.work_log where id = p_entry and employee_id = v_me for update;
    if not found then
      return ops_core.not_found('hr','work_log', p_entry::text,'edit', 'Catatan itu tidak ada di laporan Anda.');
    end if;
    if w.promoted_task_id is not null then
      return ops_core.conflict('hr','work_log', p_entry::text,'edit','already_promoted',
        'HRD sudah menjadikan catatan ini tugas. Perubahan berikutnya dicatat di tugas itu.');
    end if;
  end if;

  v_day := coalesce(p_work_date, w.work_date, v_today);
  v_window := coalesce((select (value #>> '{}')::int from ops_core.settings
                         where key = 'hr.work_log_window_days'), 366);
  if abs(v_day - v_today) > v_window then
    return ops_core.invalid('hr','work_log', null,'log','date_out_of_range',
      format('Tanggal %s terlalu jauh dari hari ini — laporan bisa diisi sampai %s hari ke belakang atau ke depan.',
             v_day, v_window),
      jsonb_build_object('field','work_date'));
  end if;
  if coalesce(btrim(coalesce(p_summary,'')),'') = '' then
    return ops_core.invalid('hr','work_log', null,'log','summary_required',
      'Apa yang dikerjakan? Satu kalimat yang bisa dibaca orang lain.', jsonb_build_object('field','summary'));
  end if;
  if p_progress is null or p_progress not in ('lanjut','selesai','tertahan') then
    return ops_core.invalid('hr','work_log', null,'log','unknown_progress',
      'Progresnya lanjut, selesai, atau tertahan.', jsonb_build_object('field','progress'));
  end if;
  if p_hours is not null and (p_hours <= 0 or p_hours > 16) then
    return ops_core.invalid('hr','work_log', null,'log','hours_invalid',
      'Jam kerja diisi antara 0,5 dan 16, atau dikosongkan.', jsonb_build_object('field','hours'));
  end if;
  if coalesce(btrim(coalesce(p_task_no,'')),'') <> '' and p_item is not null then
    return ops_core.invalid('hr','work_log', null,'log','task_or_item',
      'Pilih satu: tugas, item jangka panjang, atau dadakan.', jsonb_build_object('field','task'));
  end if;

  if coalesce(btrim(coalesce(p_task_no,'')),'') <> '' then
    select * into t from ops_hr.tasks where task_no = btrim(p_task_no);
    if not found then
      return ops_core.not_found('hr','work_log', null,'log', format('Tidak ada tugas %s.', p_task_no));
    end if;
    if t.assignee_id <> v_me then
      return ops_core.refused('hr','work_log', null,'log','task_not_yours',
        'Laporan harian hanya untuk tugas Anda sendiri. Pekerjaan untuk tugas orang lain dicatat sebagai dadakan, dengan nama yang meminta.');
    end if;
    if t.status = 'CANCELLED' then
      return ops_core.conflict('hr','work_log', null,'log','task_closed',
        format('%s sudah dibatalkan.', t.task_no));
    end if;
    if t.status = 'DONE' and v_day > ops_core.office_day(t.done_at) then
      return ops_core.conflict('hr','work_log', null,'log','task_closed',
        format('%s sudah selesai pada %s — catatan sesudahnya tidak bisa untuk tugas itu.',
               t.task_no, ops_core.office_day(t.done_at)));
    end if;
    v_task := t.id;
  elsif p_item is not null then
    select * into it from ops_hr.work_items where id = p_item and employee_id = v_me;
    if not found then
      return ops_core.not_found('hr','work_log', null,'log', 'Item itu tidak ada di daftar Anda.');
    end if;
    if it.status <> 'aktif' and v_day > ops_core.office_day(it.closed_at) then
      return ops_core.conflict('hr','work_log', null,'log','item_closed',
        format('"%s" sudah %s pada %s. Aktifkan lagi kalau masih dikerjakan.',
               it.title, it.status, ops_core.office_day(it.closed_at)));
    end if;
    v_item := it.id;
  else
    if coalesce(btrim(coalesce(p_requested_by,'')),'') = '' then
      return ops_core.invalid('hr','work_log', null,'log','requested_by_required',
        'Pekerjaan dadakan diminta oleh siapa? Tanpa nama, dadakan tidak bisa diperiksa.',
        jsonb_build_object('field','requested_by'));
    end if;
    v_asker := btrim(p_requested_by);
  end if;

  if exists (select 1 from ops_hr.work_log l
              where l.employee_id = v_me and l.work_date = v_day
                and l.id is distinct from p_entry
                and ((v_task is not null and l.task_id = v_task)
                  or (v_item is not null and l.item_id = v_item))) then
    return ops_core.conflict('hr','work_log', p_entry::text,'log','already_logged',
      format('Sudah ada catatan untuk itu pada %s. Ubah catatan yang ada, jangan membuat yang kedua.', v_day));
  end if;

  if p_entry is null then
    insert into ops_hr.work_log
      (employee_id, work_date, task_id, item_id, summary, progress, requested_by, hours, created_by)
    values (v_me, v_day, v_task, v_item, btrim(p_summary), p_progress, v_asker, p_hours, auth.uid())
    returning id into v_id;
    return ops_core.ok('hr','work_log', v_id::text,'log',
      jsonb_build_object('entry_id', v_id),
      null,
      jsonb_build_object('work_date', v_day, 'task', p_task_no, 'item', v_item, 'progress', p_progress,
                         'requested_by', v_asker, 'hours', p_hours));
  end if;

  update ops_hr.work_log
     set work_date = v_day, task_id = v_task, item_id = v_item, summary = btrim(p_summary),
         progress = p_progress, requested_by = v_asker, hours = p_hours, updated_at = now()
   where id = w.id;

  return ops_core.ok('hr','work_log', w.id::text,'edit',
    jsonb_build_object('entry_id', w.id),
    jsonb_build_object('work_date', w.work_date, 'summary', w.summary, 'progress', w.progress,
                       'requested_by', w.requested_by, 'hours', w.hours,
                       'task_id', w.task_id, 'item_id', w.item_id),
    jsonb_build_object('work_date', v_day, 'summary', btrim(p_summary), 'progress', p_progress,
                       'requested_by', v_asker, 'hours', p_hours, 'task', p_task_no, 'item', v_item));
end $$;

/* Removing one of one's own lines, any day. */
create or replace function ops_hr.remove_work_log(p_entry uuid)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare w ops_hr.work_log%rowtype;
begin
  select * into w from ops_hr.work_log
   where id = p_entry and employee_id = ops_hr.my_employee_id() for update;
  if not found then
    return ops_core.not_found('hr','work_log', p_entry::text,'remove', 'Catatan itu tidak ada di laporan Anda.');
  end if;
  if w.promoted_task_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'remove','already_promoted',
      'HRD sudah menjadikan catatan ini tugas, jadi catatannya tetap.');
  end if;
  delete from ops_hr.work_log where id = w.id;
  return ops_core.ok('hr','work_log', w.id::text,'remove',
    jsonb_build_object('entry_id', w.id),
    jsonb_build_object('work_date', w.work_date, 'summary', w.summary, 'progress', w.progress,
                       'task_id', w.task_id, 'item_id', w.item_id, 'requested_by', w.requested_by),
    null);
end $$;

/* ── promoting stays for dadakan only (`0214`'s body, the check widened) ── */
create or replace function ops_hr.promote_work_log(
  p_entry uuid, p_due date, p_goal_no text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare w ops_hr.work_log%rowtype; emp ops_hr.employees%rowtype; v_res jsonb; v_no text;
begin
  if not ops_core.has_permission('hrd.create') then
    return ops_core.refused('hr','work_log', p_entry::text,'promote',
      'not_permitted','Menjadikan pekerjaan dadakan sebagai tugas butuh akses HRD.');
  end if;
  select * into w from ops_hr.work_log where id = p_entry for update;
  if not found then
    return ops_core.not_found('hr','work_log', p_entry::text,'promote', 'Catatan itu tidak ada.');
  end if;
  if w.task_id is not null or w.item_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'promote','not_dadakan',
      'Catatan ini bukan dadakan — sudah untuk sebuah tugas atau item.');
  end if;
  if w.promoted_task_id is not null then
    return ops_core.conflict('hr','work_log', p_entry::text,'promote','already_promoted',
      'Catatan ini sudah dijadikan tugas.');
  end if;
  select * into emp from ops_hr.employees where id = w.employee_id;

  v_res := ops_hr.assign_task(
    emp.employee_no, w.summary, p_due,
    p_detail => format('Dari laporan harian %s — pekerjaan dadakan, diminta oleh %s.', w.work_date, w.requested_by),
    p_goal_no => p_goal_no);
  if v_res ->> 'outcome' <> 'ok' then return v_res; end if;
  v_no := v_res -> 'data' ->> 'task_no';

  update ops_hr.tasks
     set acknowledged_at = w.created_at, started_at = w.created_at
   where task_no = v_no;
  update ops_hr.work_log
     set promoted_task_id = (select id from ops_hr.tasks where task_no = v_no),
         promoted_by = auth.uid(), promoted_at = now()
   where id = w.id;

  return ops_core.ok('hr','work_log', w.id::text,'promote',
    jsonb_build_object('entry_id', w.id, 'task_no', v_no),
    null,
    jsonb_build_object('task_no', v_no, 'due', p_due, 'goal', p_goal_no));
end $$;

/* ── HRD's day: a planned-only line is not yet a report ─────────────────── */
create or replace function ops_hr.work_log_roster(p_date date)
returns table (
  employee_no text, full_name text, unit text, "position" text,
  scheduled boolean, mark_kind text,
  entries int, task_entries int, dadakan_entries int,
  hours numeric, dadakan_hours numeric)
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
begin
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')) then
    raise exception using errcode = '42501',
      message = 'Laporan harian semua orang butuh akses HRD.';
  end if;
  /* `task_entries` is planned work: a task or the person's own item. */
  return query
    select e.employee_no, e.full_name, e.unit, e.position,
           not ops_hr.is_rest_day(ops_hr.rules_on(p_date), p_date)
             and not coalesce((ops_hr.schedule_day(ops_hr.pattern_on(e.schedule_code, e.unit, p_date), p_date)
                               ->> 'off')::boolean, false),
           d.mark_kind::text,
           count(l.id)::int,
           count(l.id) filter (where l.task_id is not null or l.item_id is not null)::int,
           count(l.id) filter (where l.task_id is null and l.item_id is null)::int,
           coalesce(sum(l.hours), 0),
           coalesce(sum(l.hours) filter (where l.task_id is null and l.item_id is null), 0)
      from ops_hr.employees e
      left join lateral ops_hr.timesheet(e.id, p_date, p_date) d on true
      left join ops_hr.work_log l on l.employee_id = e.id and l.work_date = p_date
                                 and ops_core.office_day(coalesce(l.updated_at, l.created_at)) >= l.work_date
     where e.active and ops_hr.owes_daily_log(e.id)
     group by e.id, e.employee_no, e.full_name, e.unit, e.position, e.schedule_code, d.mark_kind
     order by count(l.id) = 0 desc, e.full_name;
end $$;

/* ── the review's evidence, with items and with when lines were written ──── */
create or replace function ops_hr.work_evidence(p_employee_no text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare emp ops_hr.employees%rowtype; lc record; v jsonb;
begin
  select * into emp from ops_hr.employees where employee_no = p_employee_no;
  if not found then
    raise exception using errcode = 'P0002', message = format('Tidak ada karyawan %s.', p_employee_no);
  end if;
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')
          or emp.id = ops_hr.my_employee_id()) then
    raise exception using errcode = '42501',
      message = 'Bukti kinerja orang lain butuh akses HRD atau penggajian.';
  end if;

  select * into lc from ops_hr.daily_log_coverage(emp.id, p_from, p_to);

  with l as (
    select w.*, t.task_no, t.title as task_title, t.status as task_status,
           g.goal_no, g.title as goal_title, i.title as item_title, i.status as item_status,
           (w.task_id is null and w.item_id is null) as dadakan,
           ops_core.office_day(w.created_at) as written_on
      from ops_hr.work_log w
      left join ops_hr.tasks t on t.id = w.task_id
      left join ops_hr.goals g on g.id = t.goal_id
      left join ops_hr.work_items i on i.id = w.item_id
     where w.employee_id = emp.id and w.work_date between p_from and p_to
  )
  select jsonb_build_object(
    'employee_no', emp.employee_no,
    'full_name', emp.full_name,
    'period_start', p_from,
    'period_end', p_to,
    'has_account', ops_hr.owes_daily_log(emp.id),
    'days_expected', lc.expected,
    'days_logged', lc.logged,
    'counted_from', lc.counted_from,
    'coverage', case when lc.expected = 0 then null
                     else round(lc.logged::numeric / lc.expected * 100)::int end,
    'entries', (select count(*) from l),
    'task_entries', (select count(*) from l where task_id is not null),
    'item_entries', (select count(*) from l where item_id is not null),
    'dadakan_entries', (select count(*) from l where dadakan),
    'dadakan_share', (select case when count(*) = 0 then null
                                  else round(count(*) filter (where dadakan)::numeric / count(*) * 100)::int end
                        from l),
    'hours_task', (select coalesce(sum(hours), 0) from l where task_id is not null),
    'hours_item', (select coalesce(sum(hours), 0) from l where item_id is not null),
    'hours_dadakan', (select coalesce(sum(hours), 0) from l where dadakan),
    'entries_without_hours', (select count(*) from l where hours is null),
    'written_later', (select count(*) from l where written_on > work_date),
    'written_ahead', (select count(*) from l where written_on < work_date),
    'promoted', (select count(*) from l where promoted_task_id is not null),
    'first_day', (select min(work_date) from l),
    'last_day', (select max(work_date) from l),
    'tasks', coalesce((
      select jsonb_agg(x order by x.days desc, x.task_no)
        from (select task_no, task_title as title, task_status::text as status, goal_title,
                     count(distinct work_date)::int as days,
                     (array_agg(progress order by work_date desc, created_at desc))[1] as last_progress
                from l where task_id is not null
               group by task_no, task_title, task_status, goal_title) x), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(x order by x.days desc, x.title)
        from (select item_title as title, item_status as status,
                     count(distinct work_date)::int as days,
                     (array_agg(progress order by work_date desc, created_at desc))[1] as last_progress
                from l where item_id is not null
               group by item_id, item_title, item_status) x), '[]'::jsonb),
    'requesters', coalesce((
      select jsonb_agg(x order by x.entries desc, x.requested_by)
        from (select requested_by, count(*)::int as entries
                from l where dadakan group by requested_by) x), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(x order by x.entries desc, x.goal_no)
        from (select goal_no, goal_title as title, count(*)::int as entries
                from l where goal_no is not null group by goal_no, goal_title) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

/* ── items: the person's own list ──────────────────────────────────────────
 *
 *  New (`p_item` null, a title) or a change: a new title, or a status —
 *  `selesai` / `dihentikan` closes it (dated), `aktif` opens it again. Lines
 *  already written for a closed item stay; new ones after its close are
 *  refused by `log_work`.
 */
create or replace function ops_hr.save_work_item(
  p_item uuid default null, p_title text default null, p_status text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_me uuid := ops_hr.my_employee_id();
  it ops_hr.work_items%rowtype; v_title text := nullif(btrim(coalesce(p_title, '')), ''); v_id uuid;
begin
  if v_me is null then
    return ops_core.refused('hr','work_item', null,'save','no_employee_link',
      'Akun ini belum tertaut ke data karyawan. Minta HRD menautkannya.');
  end if;
  if p_status is not null and p_status not in ('aktif','selesai','dihentikan') then
    return ops_core.invalid('hr','work_item', p_item::text,'save','unknown_status',
      'Statusnya aktif, selesai, atau dihentikan.', jsonb_build_object('field','status'));
  end if;
  if v_title is not null and length(v_title) > 120 then
    return ops_core.invalid('hr','work_item', p_item::text,'save','title_too_long',
      'Nama item paling panjang 120 huruf.', jsonb_build_object('field','title'));
  end if;
  if v_title is not null and exists (
       select 1 from ops_hr.work_items i
        where i.employee_id = v_me and lower(i.title) = lower(v_title)
          and i.id is distinct from p_item) then
    return ops_core.conflict('hr','work_item', p_item::text,'save','title_taken',
      format('Anda sudah punya item "%s".', v_title));
  end if;

  if p_item is null then
    if v_title is null then
      return ops_core.invalid('hr','work_item', null,'save','title_required',
        'Beri nama itemnya — mis. "Google Workspace" atau "Sistem HRD".', jsonb_build_object('field','title'));
    end if;
    insert into ops_hr.work_items (employee_id, title, created_by)
    values (v_me, v_title, auth.uid())
    returning id into v_id;
    return ops_core.ok('hr','work_item', v_id::text,'create',
      jsonb_build_object('item_id', v_id), null, jsonb_build_object('title', v_title));
  end if;

  select * into it from ops_hr.work_items where id = p_item and employee_id = v_me for update;
  if not found then
    return ops_core.not_found('hr','work_item', p_item::text,'save', 'Item itu tidak ada di daftar Anda.');
  end if;
  update ops_hr.work_items
     set title = coalesce(v_title, title),
         status = coalesce(p_status, status),
         closed_at = case when coalesce(p_status, status) = 'aktif' then null
                          when p_status is not null and p_status <> it.status then now()
                          else closed_at end
   where id = it.id;
  return ops_core.ok('hr','work_item', it.id::text,'edit',
    jsonb_build_object('item_id', it.id),
    jsonb_build_object('title', it.title, 'status', it.status),
    jsonb_build_object('title', coalesce(v_title, it.title), 'status', coalesce(p_status, it.status)));
end $$;

/* ── a week's summary, per row ─────────────────────────────────────────────
 *
 *  `p_item` / `p_task_no` name the row; neither is the *dadakan / lainnya*
 *  row. An empty summary clears it (null, no DELETE — F218).
 */
create or replace function ops_hr.save_work_week_note(
  p_week_start date, p_summary text, p_item uuid default null, p_task_no text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_me uuid := ops_hr.my_employee_id();
  v_text text := nullif(btrim(coalesce(p_summary, '')), '');
  v_task uuid; v_window int; n ops_hr.work_week_notes%rowtype;
begin
  if v_me is null then
    return ops_core.refused('hr','work_week_note', null,'save','no_employee_link',
      'Akun ini belum tertaut ke data karyawan. Minta HRD menautkannya.');
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    return ops_core.invalid('hr','work_week_note', null,'save','not_monday',
      'Minggu dimulai hari Senin.', jsonb_build_object('field','week_start'));
  end if;
  v_window := coalesce((select (value #>> '{}')::int from ops_core.settings
                         where key = 'hr.work_log_window_days'), 366);
  if abs(p_week_start - ops_core.office_day()) > v_window + 7 then
    return ops_core.invalid('hr','work_week_note', null,'save','date_out_of_range',
      format('Minggu %s terlalu jauh dari hari ini.', p_week_start), jsonb_build_object('field','week_start'));
  end if;
  if p_item is not null and coalesce(btrim(coalesce(p_task_no,'')),'') <> '' then
    return ops_core.invalid('hr','work_week_note', null,'save','task_or_item',
      'Satu ringkasan untuk satu baris: tugas, item, atau dadakan.', jsonb_build_object('field','row'));
  end if;
  if p_item is not null
     and not exists (select 1 from ops_hr.work_items where id = p_item and employee_id = v_me) then
    return ops_core.not_found('hr','work_week_note', null,'save', 'Item itu tidak ada di daftar Anda.');
  end if;
  if coalesce(btrim(coalesce(p_task_no,'')),'') <> '' then
    select id into v_task from ops_hr.tasks where task_no = btrim(p_task_no) and assignee_id = v_me;
    if v_task is null then
      return ops_core.not_found('hr','work_week_note', null,'save',
        format('Tidak ada tugas %s milik Anda.', p_task_no));
    end if;
  end if;

  select * into n from ops_hr.work_week_notes x
   where x.employee_id = v_me and x.week_start = p_week_start
     and x.item_id is not distinct from p_item and x.task_id is not distinct from v_task
   for update;
  if found then
    update ops_hr.work_week_notes
       set summary = v_text, updated_by = auth.uid(), updated_at = now()
     where id = n.id;
  elsif v_text is not null then
    insert into ops_hr.work_week_notes (employee_id, week_start, item_id, task_id, summary, updated_by)
    values (v_me, p_week_start, p_item, v_task, v_text, auth.uid());
  end if;
  return ops_core.ok('hr','work_week_note', null,'save',
    jsonb_build_object('week_start', p_week_start, 'summary', v_text),
    case when n.id is null then null else jsonb_build_object('summary', n.summary) end,
    jsonb_build_object('week_start', p_week_start, 'item', p_item, 'task', p_task_no, 'summary', v_text));
end $$;

/* ── the week the grid is drawn on ─────────────────────────────────────────
 *
 *  Seven days from a Monday: whether the person works the day (`works_on`,
 *  D383), the office holiday if any, the person's own mark, and the week's
 *  summaries. HRD and payroll read anybody's; a person their own.
 */
create or replace function ops_hr.work_week(p_employee_no text, p_week_start date)
returns jsonb
language plpgsql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare emp ops_hr.employees%rowtype; v jsonb;
begin
  select * into emp from ops_hr.employees where employee_no = p_employee_no;
  if not found then
    raise exception using errcode = 'P0002', message = format('Tidak ada karyawan %s.', p_employee_no);
  end if;
  if not (ops_core.has_permission('hrd.read') or ops_core.has_permission('payroll.read')
          or emp.id = ops_hr.my_employee_id()) then
    raise exception using errcode = '42501',
      message = 'Laporan harian orang lain butuh akses HRD.';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception using errcode = '22023', message = 'Minggu dimulai hari Senin.';
  end if;

  select jsonb_build_object(
    'employee_no', emp.employee_no,
    'full_name', emp.full_name,
    'week_start', p_week_start,
    'week_end', p_week_start + 6,
    'mine', coalesce(emp.id = ops_hr.my_employee_id(), false),
    'days', (
      select jsonb_agg(jsonb_build_object(
               'date', d::date,
               'works', ops_hr.works_on(emp.id, d::date),
               'rest', ops_hr.is_rest_day(ops_hr.rules_on(d::date), d::date),
               'holiday', (select m.reason from ops_hr.day_marks m
                            where m.work_date = d::date and m.employee_id is null
                              and m.kind = 'holiday' and m.withdrawn_at is null
                            limit 1),
               'mark_kind', (select m.kind::text from ops_hr.day_marks m
                              where m.work_date = d::date and m.employee_id = emp.id
                                and m.withdrawn_at is null
                              limit 1),
               'mark_reason', (select m.reason from ops_hr.day_marks m
                                where m.work_date = d::date and m.employee_id = emp.id
                                  and m.withdrawn_at is null
                                limit 1)) order by d)
        from generate_series(p_week_start, p_week_start + 6, interval '1 day') d),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', n.item_id, 'task_no', t.task_no, 'task_title', t.title,
               'summary', n.summary, 'updated_at', n.updated_at) order by n.updated_at)
        from ops_hr.work_week_notes n
        left join ops_hr.tasks t on t.id = n.task_id
       where n.employee_id = emp.id and n.week_start = p_week_start and n.summary is not null),
      '[]'::jsonb)
  ) into v;
  return v;
end $$;

/* ── grants, named one at a time (F147) ───────────────────────────────── */
revoke execute on function ops_hr.log_work(text, text, text, text, numeric, uuid, uuid, date) from public;
revoke execute on function ops_hr.save_work_item(uuid, text, text) from public;
revoke execute on function ops_hr.save_work_week_note(date, text, uuid, text) from public;
revoke execute on function ops_hr.work_week(text, date) from public;

grant execute on function ops_hr.log_work(text, text, text, text, numeric, uuid, uuid, date) to authenticated;
grant execute on function ops_hr.save_work_item(uuid, text, text) to authenticated;
grant execute on function ops_hr.save_work_week_note(date, text, uuid, text) to authenticated;
grant execute on function ops_hr.work_week(text, date) to authenticated;

analyze ops_hr.work_items;
analyze ops_hr.work_week_notes;
analyze ops_hr.work_log;
