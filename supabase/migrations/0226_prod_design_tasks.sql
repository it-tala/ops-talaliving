-- 0226_prod_design_tasks.sql — the drafters' queue, live: a task per design
-- item (or per product), revisions that are files, and the questions that
-- hold a release (P6, D179, D379, kajian F224 §4.3, G15).
--
-- M30 built the queue in the sandbox only (D179): a task per product, a
-- revision as a typed filename, a status somebody set. The owner's order for
-- the drafters (D379) is client → project → collection → room → item, and an
-- item is not a product until it is ordered. So here:
--
--   design_tasks      one per drawing kind of a design item (`item_no`, the
--                     item's public number, ADR-004) — or of a catalogue
--                     product with no project behind it (`product_code`).
--                     Who is drawing it (free text: a freelance drafter is a
--                     legitimate answer, D264) and by when.
--   design_revisions  A, B, C — each an **uploaded file** filed on the item or
--                     the product (`attachment_id` not null), released as a
--                     separate act (D179). Append-only.
--   design_questions  what the drafter cannot answer alone. An open one
--                     refuses a release.
--
-- A release does not wait for the client's approval (D378): the view says
-- whether the item is approved, and the screen warns.
--
-- DERIVED, never typed (A3): the status — TANYA while a question is open,
-- RILIS once a revision is released, DIGAMBAR once somebody holds it or a
-- revision exists, BELUM before; `ahead_of_release` (a newer revision than the
-- released one); and `needed_by` — the soonest of the task's own date, the
-- open work orders for its product, and the target date of the live project
-- the item belongs to (F51: a finished project's date is not a deadline).
--
-- WHO: the drafters (`production.update`) take a task on, upload and release.
-- Whoever works on a design (`may_design`, 0222) reads the queue, raises a task
-- for an item, and asks or answers a question — the client's answer usually
-- comes through the person selling.
--
-- For the production tool (F226): no drops, and no function body here removes
-- rows.

insert into ops_core.doc_prefixes (prefix, what) values ('dsn', 'design task')
on conflict (prefix) do nothing;

-- ── 1. the tables ─────────────────────────────────────────────────────────

create table ops_prod.design_tasks (
  id            uuid primary key default gen_random_uuid(),
  task_no       text not null unique default ops_core.next_doc_number('dsn'),
  -- A design item by its number, or a catalogue product by its code: codes at
  -- the seam, never foreign keys across schemas (ADR-004).
  item_no       text,
  product_code  text,
  kind          text not null check (kind in ('gambar_kerja','gambar_jadi')),
  assignee      text,
  due_date      date,
  note          text,
  created_by    uuid references ops_core.users(id),
  created_at    timestamptz not null default now(),
  constraint task_is_about_something check (item_no is not null or product_code is not null)
);
create unique index design_tasks_item_kind on ops_prod.design_tasks (item_no, kind) where item_no is not null;
create unique index design_tasks_product_kind on ops_prod.design_tasks (product_code, kind) where item_no is null;

create table ops_prod.design_revisions (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references ops_prod.design_tasks(id),
  rev           text not null check (rev ~ '^[A-Z0-9]{1,4}$'),
  attachment_id uuid not null references ops_core.attachments(id),
  note          text,
  released_at   timestamptz,
  released_by   uuid references ops_core.users(id),
  uploaded_by   uuid references ops_core.users(id),
  -- clock_timestamp: two revisions in one call keep their order (F228).
  uploaded_at   timestamptz not null default clock_timestamp(),
  unique (task_id, rev)
);

create table ops_prod.design_questions (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references ops_prod.design_tasks(id),
  asked_of     text not null check (length(btrim(asked_of)) > 0),
  question     text not null check (length(btrim(question)) > 0),
  answer       text,
  asked_by     uuid references ops_core.users(id),
  asked_at     timestamptz not null default clock_timestamp(),
  answered_by  uuid references ops_core.users(id),
  answered_at  timestamptz,
  constraint answered_once check ((answer is null) = (answered_at is null))
);

alter table ops_prod.design_tasks     enable row level security;
alter table ops_prod.design_revisions enable row level security;
alter table ops_prod.design_questions enable row level security;
create policy design_tasks_read on ops_prod.design_tasks for select to authenticated
  using (ops_procure.may_design('read'));
create policy design_revisions_read on ops_prod.design_revisions for select to authenticated
  using (ops_procure.may_design('read'));
create policy design_questions_read on ops_prod.design_questions for select to authenticated
  using (ops_procure.may_design('read'));
grant select on ops_prod.design_tasks, ops_prod.design_revisions, ops_prod.design_questions to authenticated;

-- ── 2. what the queue reads ───────────────────────────────────────────────

create or replace view ops_prod.v_design_task as
with t as (
  select dt.*,
         di.id as item_id, di.name as item_name,
         di.length_mm as item_l, di.width_mm as item_w, di.height_mm as item_h,
         dr.code as room_code, dr.name as room_name, dr.sort as room_sort,
         dc.code as collection_code, dc.name as collection_name,
         pr.code as project_code, pr.name as project_name,
         pr.is_active and pr.status not in ('LOST','CANCELLED','DONE') as project_live,
         pr.target_date as project_target,
         cl.code as client_code, coalesce(cl.name, pr.client_name) as client_display,
         -- The product it is drawn for: named on the task, or the one the
         -- item became on its order line (0225).
         coalesce(dt.product_code, di.product_code,
                  (select max(pl.product_code) from ops_procure.project_lines pl
                    where pl.design_item_id = di.id)) as eff_product
    from ops_prod.design_tasks dt
    left join ops_procure.design_items di on di.item_no = dt.item_no
    left join ops_procure.design_rooms dr on dr.id = di.room_id
    left join ops_procure.design_collections dc on dc.id = dr.collection_id
    left join ops_procure.projects pr on pr.id = dc.project_id
    left join ops_procure.clients cl on cl.id = pr.client_id
),
revs as (
  select r.task_id,
         (array_agg(r.rev order by r.uploaded_at desc))[1]                                as latest_rev,
         (array_agg(r.rev order by r.released_at desc) filter (where r.released_at is not null))[1] as released_rev,
         count(*)::int as revision_count
    from ops_prod.design_revisions r group by r.task_id
),
qs as (
  select q.task_id, count(*) filter (where q.answer is null)::int as open_questions
    from ops_prod.design_questions q group by q.task_id
),
wos as (
  select w.product_code,
         min(w.due_date) filter (where w.status = 'OPEN') as open_due,
         jsonb_agg(jsonb_build_object('wo_no', w.wo_no, 'due_date', w.due_date, 'status', w.status)
                   order by w.due_date) as work_orders
    from ops_prod.work_orders w
   where w.status <> 'CANCELLED' and w.product_code is not null
   group by w.product_code
)
select
  t.id, t.task_no, t.item_no, t.eff_product as product_code, t.kind, t.assignee, t.due_date, t.note,
  t.created_by, t.created_at,
  coalesce(p.name, t.item_name, t.eff_product)                as product_name,
  coalesce(p.category, '—')                                   as category,
  case when p.length_mm is not null and p.width_mm is not null and p.height_mm is not null
         then format('%s × %s × %s mm', p.length_mm, p.width_mm, p.height_mm)
       when t.item_l is not null or t.item_w is not null or t.item_h is not null
         then format('%s × %s × %s mm', coalesce(t.item_l::text, '–'), coalesce(t.item_w::text, '–'), coalesce(t.item_h::text, '–'))
  end                                                         as dimension,
  t.item_name, t.collection_code, t.collection_name, t.room_code, t.room_name, t.room_sort,
  t.project_code, t.project_name, t.client_code, t.client_display,
  case
    when coalesce(q.open_questions, 0) > 0       then 'TANYA'
    when r.released_rev is not null              then 'RILIS'
    when t.assignee is not null or r.latest_rev is not null then 'DIGAMBAR'
    else 'BELUM'
  end                                                         as status,
  r.released_rev, r.latest_rev,
  (r.released_rev is not null and r.latest_rev <> r.released_rev) as ahead_of_release,
  coalesce(q.open_questions, 0) > 0                           as is_blocked,
  coalesce(r.revision_count, 0)                               as revision_count,
  coalesce(w.work_orders, '[]'::jsonb)                        as work_orders,
  case when t.project_code is not null and t.project_live then array[t.project_code] else array[]::text[] end as ordered_by,
  n.needed_by,
  n.needed_by - ops_core.office_day()                         as days_left,
  -- The client's latest word on the item (D378): released without it is
  -- allowed, and said. Null for a catalogue product.
  case when t.item_id is not null then coalesce(ap.decision = 'approved', false) end as item_approved
from t
left join ops_prod.products p on p.product_code = t.eff_product
left join revs r on r.task_id = t.id
left join qs q on q.task_id = t.id
left join wos w on w.product_code = t.eff_product
cross join lateral (
  select least(t.due_date, w.open_due, case when t.project_live then t.project_target end) as needed_by
) n
left join lateral (
  select a.decision from ops_procure.design_approvals a
   where a.item_id = t.item_id order by a.recorded_at desc limit 1
) ap on true;
alter view ops_prod.v_design_task set (security_invoker = on);

create or replace view ops_prod.v_design_revision as
select r.id, r.task_id, t.task_no, r.rev, r.attachment_id, a.filename, r.note,
       r.released_at, r.released_by, coalesce(rb.full_name, rb.email) as released_by_name,
       r.uploaded_by, coalesce(ub.full_name, ub.email, '—') as uploaded_by_name, r.uploaded_at
  from ops_prod.design_revisions r
  join ops_prod.design_tasks t on t.id = r.task_id
  left join ops_core.attachments a on a.id = r.attachment_id
  left join ops_core.users rb on rb.id = r.released_by
  left join ops_core.users ub on ub.id = r.uploaded_by;
alter view ops_prod.v_design_revision set (security_invoker = on);

create or replace view ops_prod.v_design_question as
select q.id, q.task_id, t.task_no, q.asked_of, q.question, q.answer,
       q.asked_by, coalesce(ab.full_name, ab.email, '—') as asked_by_name, q.asked_at,
       q.answered_by, coalesce(nb.full_name, nb.email) as answered_by_name, q.answered_at,
       case when q.answer is null then ops_core.office_day() - ops_core.office_day(q.asked_at) end as waiting_days
  from ops_prod.design_questions q
  join ops_prod.design_tasks t on t.id = q.task_id
  left join ops_core.users ab on ab.id = q.asked_by
  left join ops_core.users nb on nb.id = q.answered_by;
alter view ops_prod.v_design_question set (security_invoker = on);

-- What should have a task and has none: products ordered or on the floor
-- (D179), and design items the client approved or that were quoted or ordered
-- (P6) — without a working drawing. Read by whoever reads the queue: the
-- work orders behind it are readable more widely than the queue is.
create or replace view ops_prod.v_design_gap as
with wanted_products as (
  select w.product_code, format('sedang dikerjakan · %s', min(w.wo_no)) as why
    from ops_prod.work_orders w
   where w.product_code is not null and w.status = 'OPEN'
   group by w.product_code
  union
  select pl.product_code, format('dipesan · %s', min(pr.code))
    from ops_procure.project_lines pl
    join ops_procure.projects pr on pr.id = pl.project_id
   where pl.product_code is not null and pr.is_active and pl.design_item_id is null
     and not exists (select 1 from ops_prod.work_orders w where w.product_code = pl.product_code and w.status = 'OPEN')
   group by pl.product_code
)
select null::text as item_no, wp.product_code, coalesce(p.name, wp.product_code) as product_name, k.kind, wp.why,
       null::text as project_code, null::text as collection_code, null::text as room_name
  from wanted_products wp
  left join ops_prod.products p on p.product_code = wp.product_code
 cross join (values ('gambar_kerja'), ('gambar_jadi')) k(kind)
 where ops_procure.may_design('read')
   and not exists (select 1 from ops_prod.design_tasks dt
                    where dt.kind = k.kind and (dt.product_code = wp.product_code
                       or dt.item_no in (select di.item_no from ops_procure.design_items di where di.product_code = wp.product_code)))
union all
select i.item_no, i.product_code, i.name, 'gambar_kerja',
       case i.status when 'ORDERED' then 'dipesan' when 'QUOTED' then format('ditawarkan · %s', i.quote_no)
                     else 'disetujui klien' end,
       i.project_code, i.collection_code, i.room_name
  from ops_procure.v_design_item i
 where i.status in ('APPROVED','QUOTED','ORDERED')
   and not exists (select 1 from ops_prod.design_tasks dt where dt.item_no = i.item_no and dt.kind = 'gambar_kerja');
alter view ops_prod.v_design_gap set (security_invoker = on);

grant select on ops_prod.v_design_task, ops_prod.v_design_revision, ops_prod.v_design_question,
                ops_prod.v_design_gap to authenticated;

-- ── 3. the seams ──────────────────────────────────────────────────────────

-- A task for a drawing: of a design item, or of a catalogue product with no
-- project behind it. One per item (or product) and kind — a new revision goes
-- to the task that exists, not to a second one.
create or replace function ops_prod.create_design_task(
  p_kind text, p_item_no text default null, p_product_code text default null,
  p_assignee text default null, p_due_date date default null, p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare replayed jsonb; res jsonb; v_item text := nullif(btrim(p_item_no), '');
        v_code text := nullif(upper(btrim(coalesce(p_product_code, ''))), ''); v_kind text := lower(btrim(coalesce(p_kind, '')));
        v_dropped timestamptz; v_clash text; v_no text;
begin
  replayed := ops_core.idem_replay('production', 'create_design_task', p_key);
  if replayed is not null then return replayed; end if;
  if not (ops_core.has_permission('production.update') or ops_procure.may_design('update')) then
    return ops_core.refused('production','design_task', coalesce(v_item, v_code),'create',
      'not_permitted','Membuat tugas gambar butuh akses produksi, proyek, atau marketing (update).');
  end if;
  if v_kind not in ('gambar_kerja','gambar_jadi') then
    return ops_core.invalid('production','design_task', coalesce(v_item, v_code),'create', 'bad_kind',
      'Gambar kerja atau gambar jadi?', jsonb_build_object('field','kind'));
  end if;
  if v_item is null and v_code is null then
    return ops_core.invalid('production','design_task', null,'create', 'nothing_to_draw',
      'Gambar untuk item desain atau produk yang mana?', jsonb_build_object('field','item_no'));
  end if;
  if v_item is not null then
    select dropped_at into v_dropped from ops_procure.design_items where item_no = v_item;
    if not found then
      return ops_core.not_found('production','design_task', v_item,'create', format('Tidak ada item %s.', v_item));
    end if;
    if v_dropped is not null then
      return ops_core.invalid('production','design_task', v_item,'create', 'item_dropped',
        format('Item %s sudah dikeluarkan dari desain.', v_item), jsonb_build_object('field','item_no'));
    end if;
    select task_no into v_clash from ops_prod.design_tasks where item_no = v_item and kind = v_kind;
  else
    if not exists (select 1 from ops_prod.products where product_code = v_code) then
      return ops_core.not_found('production','design_task', v_code,'create', format('Tidak ada produk %s.', v_code));
    end if;
    select task_no into v_clash from ops_prod.design_tasks where product_code = v_code and kind = v_kind and item_no is null;
  end if;
  if v_clash is not null then
    return ops_core.conflict('production','design_task', coalesce(v_item, v_code),'create', 'task_exists',
      format('%s sudah menangani gambar ini. Revisi baru masuk ke situ, bukan ke tugas kedua.', v_clash));
  end if;
  insert into ops_prod.design_tasks (item_no, product_code, kind, assignee, due_date, note, created_by)
  values (v_item, case when v_item is null then v_code end, v_kind, nullif(btrim(p_assignee), ''), p_due_date,
          nullif(btrim(p_note), ''), auth.uid())
  returning task_no into v_no;
  res := ops_core.ok('production','design_task', v_no,'create', jsonb_build_object('task_no', v_no));
  return ops_core.idem_remember('production', 'create_design_task', p_key, res);
end $$;
revoke all on function ops_prod.create_design_task(text, text, text, text, date, text, text) from public;
grant execute on function ops_prod.create_design_task(text, text, text, text, date, text, text) to authenticated;

-- Who is drawing it, and by when.
create or replace function ops_prod.assign_design_task(
  p_task_no text, p_assignee text, p_due_date date default null, p_keep_due boolean default true)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare v_id uuid;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','design_task', p_task_no,'assign',
      'not_permitted','Memberi tugas gambar butuh akses produksi (update).');
  end if;
  update ops_prod.design_tasks
     set assignee = nullif(btrim(p_assignee), ''),
         due_date = case when p_keep_due and p_due_date is null then due_date else p_due_date end
   where task_no = p_task_no
  returning id into v_id;
  if v_id is null then
    return ops_core.not_found('production','design_task', p_task_no,'assign', format('Tidak ada tugas %s.', p_task_no));
  end if;
  return ops_core.ok('production','design_task', p_task_no,'assign', jsonb_build_object('task_no', p_task_no));
end $$;
revoke all on function ops_prod.assign_design_task(text, text, date, boolean) from public;
grant execute on function ops_prod.assign_design_task(text, text, date, boolean) to authenticated;

-- The checks every release passes: nothing open.
create or replace function ops_prod.design_release_refused(p_task ops_prod.design_tasks)
returns jsonb
language plpgsql stable set search_path = ops_prod, ops_core, pg_temp as $$
declare v_n int; v_q text;
begin
  select count(*), min(question) into v_n, v_q from ops_prod.design_questions
   where task_id = p_task.id and answer is null;
  if v_n > 0 then
    return ops_core.refused('production','design_task', p_task.task_no,'release', 'question_open',
      format('Masih ada %s pertanyaan yang belum dijawab: "%s". Rilis berarti bengkel boleh memotong dari gambar ini.', v_n, v_q),
      jsonb_build_object('questions', v_n));
  end if;
  return null;
end $$;
revoke all on function ops_prod.design_release_refused(ops_prod.design_tasks) from public;

-- A revision is an upload, not an edit: a file already filed on the item (or
-- the product), numbered by the drafter. Releasing it may be the same act.
create or replace function ops_prod.add_design_revision(
  p_task_no text, p_rev text, p_attachment_id uuid, p_note text default null, p_release boolean default false)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare t ops_prod.design_tasks; v_rev text := upper(btrim(coalesce(p_rev, ''))); v_bad jsonb;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','design_task', p_task_no,'revise',
      'not_permitted','Mengunggah revisi butuh akses produksi (update).');
  end if;
  select * into t from ops_prod.design_tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('production','design_task', p_task_no,'revise', format('Tidak ada tugas %s.', p_task_no));
  end if;
  if v_rev !~ '^[A-Z0-9]{1,4}$' then
    return ops_core.invalid('production','design_task', p_task_no,'revise', 'rev_required',
      'Revisi harus punya nomor — A, B, C. Itu yang disebut orang bengkel.', jsonb_build_object('field','rev'));
  end if;
  if p_attachment_id is null then
    return ops_core.invalid('production','design_task', p_task_no,'revise', 'file_required',
      'Revisi adalah file gambarnya. Unggah dulu filenya.', jsonb_build_object('field','attachment_id'));
  end if;
  if not exists (
       select 1 from ops_core.attachment_links l
        where l.attachment_id = p_attachment_id and l.unlinked_at is null
          and ((t.item_no is not null and l.entity = 'design_item' and l.entity_no = t.item_no)
            or (t.item_no is null and l.entity = 'product' and l.entity_no = t.product_code))) then
    return ops_core.invalid('production','design_task', p_task_no,'revise', 'file_not_on_task',
      'File revisi harus diarsipkan pada item (atau produk) tugas ini.', jsonb_build_object('field','attachment_id'));
  end if;
  if exists (select 1 from ops_prod.design_revisions where task_id = t.id and rev = v_rev) then
    return ops_core.conflict('production','design_task', p_task_no,'revise', 'rev_exists',
      format('Revisi %s sudah ada di %s.', v_rev, t.task_no));
  end if;
  if p_release then
    v_bad := ops_prod.design_release_refused(t);
    if v_bad is not null then return v_bad; end if;
  end if;
  insert into ops_prod.design_revisions (task_id, rev, attachment_id, note, released_at, released_by, uploaded_by)
  values (t.id, v_rev, p_attachment_id, nullif(btrim(p_note), ''),
          case when p_release then clock_timestamp() end, case when p_release then auth.uid() end, auth.uid());
  return ops_core.ok('production','design_task', t.task_no, case when p_release then 'release' else 'revise' end,
    jsonb_build_object('task_no', t.task_no, 'rev', v_rev));
end $$;
revoke all on function ops_prod.add_design_revision(text, text, uuid, text, boolean) from public;
grant execute on function ops_prod.add_design_revision(text, text, uuid, text, boolean) to authenticated;

-- Releasing a revision uploaded earlier: from now the workshop may cut from it.
create or replace function ops_prod.release_design_revision(p_task_no text, p_rev text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare t ops_prod.design_tasks; r ops_prod.design_revisions; v_bad jsonb;
begin
  if not ops_core.has_permission('production.update') then
    return ops_core.refused('production','design_task', p_task_no,'release',
      'not_permitted','Merilis gambar butuh akses produksi (update).');
  end if;
  select * into t from ops_prod.design_tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('production','design_task', p_task_no,'release', format('Tidak ada tugas %s.', p_task_no));
  end if;
  select * into r from ops_prod.design_revisions where task_id = t.id and rev = upper(btrim(coalesce(p_rev, '')));
  if not found then
    return ops_core.not_found('production','design_task', p_task_no,'release', format('Tidak ada revisi %s di %s.', p_rev, p_task_no));
  end if;
  if r.released_at is not null then
    return ops_core.conflict('production','design_task', p_task_no,'release', 'already_released',
      format('Revisi %s sudah dirilis — tidak ada yang berubah.', r.rev));
  end if;
  v_bad := ops_prod.design_release_refused(t);
  if v_bad is not null then return v_bad; end if;
  update ops_prod.design_revisions set released_at = clock_timestamp(), released_by = auth.uid() where id = r.id;
  return ops_core.ok('production','design_task', t.task_no,'release', jsonb_build_object('task_no', t.task_no, 'rev', r.rev));
end $$;
revoke all on function ops_prod.release_design_revision(text, text) from public;
grant execute on function ops_prod.release_design_revision(text, text) to authenticated;

-- The question a drafter cannot answer alone. It holds the release.
create or replace function ops_prod.ask_design_question(p_task_no text, p_asked_of text, p_question text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare t ops_prod.design_tasks; v_id uuid;
begin
  if not (ops_core.has_permission('production.update') or ops_procure.may_design('update')) then
    return ops_core.refused('production','design_task', p_task_no,'ask',
      'not_permitted','Bertanya pada tugas gambar butuh akses produksi, proyek, atau marketing (update).');
  end if;
  select * into t from ops_prod.design_tasks where task_no = p_task_no;
  if not found then
    return ops_core.not_found('production','design_task', p_task_no,'ask', format('Tidak ada tugas %s.', p_task_no));
  end if;
  if coalesce(btrim(p_question), '') = '' then
    return ops_core.invalid('production','design_task', p_task_no,'ask', 'question_required',
      'Tulis pertanyaannya.', jsonb_build_object('field','question'));
  end if;
  insert into ops_prod.design_questions (task_id, asked_of, question, asked_by)
  values (t.id, coalesce(nullif(btrim(p_asked_of), ''), 'pimpinan'), btrim(p_question), auth.uid())
  returning id into v_id;
  return ops_core.ok('production','design_task', t.task_no,'ask', jsonb_build_object('task_no', t.task_no, 'question_id', v_id));
end $$;
revoke all on function ops_prod.ask_design_question(text, text, text) from public;
grant execute on function ops_prod.ask_design_question(text, text, text) to authenticated;

-- The answer, once: it is not overwritten.
create or replace function ops_prod.answer_design_question(p_question_id uuid, p_answer text)
returns jsonb
language plpgsql security definer set search_path = ops_prod, ops_core, pg_temp as $$
declare q ops_prod.design_questions; v_task text;
begin
  if not (ops_core.has_permission('production.update') or ops_procure.may_design('update')) then
    return ops_core.refused('production','design_question', p_question_id::text,'answer',
      'not_permitted','Menjawab pertanyaan gambar butuh akses produksi, proyek, atau marketing (update).');
  end if;
  select * into q from ops_prod.design_questions where id = p_question_id;
  if not found then
    return ops_core.not_found('production','design_question', p_question_id::text,'answer', 'Pertanyaan itu tidak ada.');
  end if;
  select task_no into v_task from ops_prod.design_tasks where id = q.task_id;
  if q.answer is not null then
    return ops_core.conflict('production','design_question', v_task,'answer', 'already_answered',
      'Pertanyaan itu sudah dijawab — jawabannya tidak ditimpa.');
  end if;
  if coalesce(btrim(p_answer), '') = '' then
    return ops_core.invalid('production','design_question', v_task,'answer', 'answer_required',
      'Tulis jawabannya.', jsonb_build_object('field','answer'));
  end if;
  update ops_prod.design_questions set answer = btrim(p_answer), answered_by = auth.uid(), answered_at = clock_timestamp()
   where id = q.id;
  return ops_core.ok('production','design_question', v_task,'answer', jsonb_build_object('task_no', v_task));
end $$;
revoke all on function ops_prod.answer_design_question(uuid, text) from public;
grant execute on function ops_prod.answer_design_question(uuid, text) to authenticated;

analyze ops_prod.design_tasks;
analyze ops_prod.design_revisions;
analyze ops_prod.design_questions;
