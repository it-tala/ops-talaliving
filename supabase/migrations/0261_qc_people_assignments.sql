-- 0261_qc_people_assignments.sql — the field QC team and who watches which
-- factory order (O6, kajian F255 §5.7, Q88, D412–D414, D418).
--
-- TALA's partner factories are watched by an outsourced QC team, not staff
-- (§1). Until now they existed only in WhatsApp: nobody could say who was at
-- which factory for which order, since when, or until when (G7, G9).
--
--   qc_people        name, phone, city, the ops account they sign in with
--                    (optional), active or not. Kept by the coordinator.
--   qc_assignments   one person on one factory order (O3), from a date, until
--                    a date. A wrong one is cancelled with a reason, never
--                    deleted. No fee (D412); the 1-QC-per-5-containers ratio
--                    is the coordinator's own judgement, not a rule (D414).
--
-- Access (Q88):
--   * `qc.coordinate` (admin of the new `qc` module, 0260) keeps the people
--     and the assignments;
--   * leadership and procurement read every assignment (`project.update`,
--     `procurement.read`) — they run the factory orders;
--   * a QC (`qc: write`) reads **only their own** assignments, and through
--     them the order's number, factory, project and lines with the working
--     drawing — never a price. The order is read through definer functions
--     that return exactly that, because a QC does not read purchase orders.
--
-- Linking an account to a person grants it `qc: write` when it has no `qc`
-- grant yet: the coordinator owns the module, and a person who can sign in but
-- not see their assignment is a support call. Nothing else is granted.
--
-- Reports, findings and progress are O7.

create schema if not exists ops_qc;
grant usage on schema ops_qc to authenticated;

insert into ops_core.permission_catalog (module, action, admin_only) values
  ('qc','read',false), ('qc','create',false), ('qc','update',false), ('qc','coordinate',true)
on conflict do nothing;

insert into ops_core.doc_prefixes (prefix, what) values
  ('qca', 'QC assignment (penugasan QC)')
on conflict (prefix) do nothing;

-- ── 1. tables ─────────────────────────────────────────────────────────────

create sequence if not exists ops_qc.qc_people_seq;

create table if not exists ops_qc.qc_people (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default 'QC-' || lpad(nextval('ops_qc.qc_people_seq')::text, 3, '0'),
  name        text not null check (btrim(name) <> ''),
  phone       text,
  city        text,
  -- The ops account they sign in with from their phone. Optional: a person
  -- can be assigned before their account exists.
  user_id     uuid unique references ops_core.users(id),
  is_active   boolean not null default true,
  inactive_reason text,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists ops_qc.qc_assignments (
  id            uuid primary key default gen_random_uuid(),
  assign_no     text not null unique,
  person_id     uuid not null references ops_qc.qc_people(id),
  po_id         uuid not null references ops_procure.purchase_orders(id),
  starts_on     date not null,
  ends_on       date,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  cancel_reason text,
  constraint qc_assignment_dates check (ends_on is null or ends_on >= starts_on)
);
-- One person, one live assignment per order.
create unique index if not exists qc_assignments_live_uq
  on ops_qc.qc_assignments (person_id, po_id) where cancelled_at is null;
create index if not exists qc_assignments_po_idx on ops_qc.qc_assignments (po_id);

-- ── 2. who reads what ─────────────────────────────────────────────────────

create or replace function ops_qc.is_coordinator()
returns boolean
language sql stable
set search_path = ops_core, pg_temp
as $$ select ops_core.has_permission('qc.coordinate') $$;
grant execute on function ops_qc.is_coordinator() to authenticated;

-- Everybody who runs factory orders reads every assignment.
create or replace function ops_qc.sees_all()
returns boolean
language sql stable
set search_path = ops_core, pg_temp
as $$
  select ops_core.has_permission('qc.coordinate')
      or ops_core.has_permission('project.update')
      or ops_core.has_permission('procurement.read')
$$;
grant execute on function ops_qc.sees_all() to authenticated;

-- The QC person the signed-in account is. Definer: a QC reads their own row
-- through the policy below, which itself asks this.
create or replace function ops_qc.my_person_id()
returns uuid
language sql stable security definer
set search_path = ops_qc, pg_temp
as $$ select p.id from ops_qc.qc_people p where p.user_id = auth.uid() and p.is_active $$;
revoke all on function ops_qc.my_person_id() from public;
grant execute on function ops_qc.my_person_id() to authenticated;

alter table ops_qc.qc_people enable row level security;
alter table ops_qc.qc_assignments enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'ops_qc' and policyname = 'qc_people_read') then
    create policy qc_people_read on ops_qc.qc_people for select
      using (ops_qc.sees_all() or user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'ops_qc' and policyname = 'qc_assignments_read') then
    create policy qc_assignments_read on ops_qc.qc_assignments for select
      using (ops_qc.sees_all() or (person_id = ops_qc.my_person_id() and cancelled_at is null));
  end if;
end $$;

grant select on ops_qc.qc_people, ops_qc.qc_assignments to authenticated;

-- May the signed-in account read this factory order through QC?
create or replace function ops_qc.may_see_order(p_po_id uuid)
returns boolean
language sql stable security definer
set search_path = ops_qc, pg_temp
as $$
  select ops_qc.sees_all()
      or exists (select 1 from ops_qc.qc_assignments a
                  where a.po_id = p_po_id and a.cancelled_at is null
                    and a.person_id = ops_qc.my_person_id())
$$;
revoke all on function ops_qc.may_see_order(uuid) from public;
grant execute on function ops_qc.may_see_order(uuid) to authenticated;

-- The factory order an assignment watches, as a QC may read it: number,
-- state, factory, project, promised date, how many lines and containers.
-- Never a price.
create or replace function ops_qc.order_of(p_po_id uuid)
returns table (po_no text, po_status ops_procure.po_status_t, vendor_name text, vendor_address text,
               project_code text, project_name text, client_name text,
               expected_delivery date, issued_at timestamptz, line_count int, container_count int)
language sql stable security definer
set search_path = ops_qc, ops_procure, pg_temp
as $$
  select p.po_no, p.status, v.name, v.address, pj.code, pj.name, coalesce(c.name, pj.client_name),
         p.expected_delivery, p.issued_at,
         (select count(*)::int from ops_procure.po_lines o where o.po_id = p.id and o.superseded_by is null),
         (select count(*)::int from ops_dlv.deliveries d
           where d.po_id = p.id and d.delivery_mode = 'container' and d.status <> 'CANCELLED')
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    left join ops_procure.projects pj on pj.id = p.project_id
    left join ops_procure.clients c on c.id = pj.client_id
   where p.id = p_po_id and ops_qc.may_see_order(p_po_id)
$$;
revoke all on function ops_qc.order_of(uuid) from public;
grant execute on function ops_qc.order_of(uuid) to authenticated;

-- What a QC checks on an assignment: the order's lines, the client's order
-- line each makes, its design item and the newest working drawing filed on it
-- (0248's box). Quantities, never prices.
create or replace function ops_qc.assignment_lines(p_assign_no text)
returns table (line_no int, description text, qty numeric, uom text, project_line_no int,
               design_item_no text, product_code text,
               drawing_attachment_id uuid, drawing_filename text, drawing_url text)
language sql stable security definer
set search_path = ops_qc, ops_procure, ops_core, pg_temp
as $$
  select o.line_no, o.description, o.qty, o.uom, pl.line_no, di.item_no, pl.product_code,
         dw.id, dw.filename, dw.url
    from ops_qc.qc_assignments a
    join ops_procure.po_lines o on o.po_id = a.po_id and o.superseded_by is null
    left join ops_procure.project_lines pl on pl.id = o.project_line_id
    left join ops_procure.design_items di on di.id = pl.design_item_id
    left join lateral (
      select at.id, at.filename, coalesce(at.web_view_link, at.url) as url
        from ops_core.attachment_links k
        join ops_core.attachments at on at.id = k.attachment_id
       where k.entity = 'design_item' and k.entity_no = di.item_no and k.unlinked_at is null
         and k.kind = 'gambar_kerja'
       order by k.linked_at desc
       limit 1) dw on true
   where a.assign_no = btrim(p_assign_no) and a.cancelled_at is null
     and (ops_qc.sees_all() or a.person_id = ops_qc.my_person_id())
   order by o.line_no
$$;
revoke all on function ops_qc.assignment_lines(text) from public;
grant execute on function ops_qc.assignment_lines(text) to authenticated;

-- The factory orders a coordinator can send somebody to — live, of a project
-- — with who already watches each. The coordinator does not read purchase
-- orders; this is the list they pick from, without a price.
create or replace function ops_qc.assignable_orders()
returns table (po_no text, po_status ops_procure.po_status_t, vendor_name text, project_code text,
               project_name text, expected_delivery date, line_count int, qc_names text)
language sql stable security definer
set search_path = ops_qc, ops_procure, pg_temp
as $$
  select p.po_no, p.status, v.name, pj.code, pj.name, p.expected_delivery,
         (select count(*)::int from ops_procure.po_lines o where o.po_id = p.id and o.superseded_by is null),
         (select string_agg(x.name, ', ' order by x.name)
            from ops_qc.qc_assignments a join ops_qc.qc_people x on x.id = a.person_id
           where a.po_id = p.id and a.cancelled_at is null)
    from ops_procure.purchase_orders p
    join ops_procure.vendors v on v.id = p.vendor_id
    join ops_procure.projects pj on pj.id = p.project_id
   where p.status not in ('CANCELLED','CLOSED') and ops_qc.sees_all()
   order by p.created_at desc
$$;
revoke all on function ops_qc.assignable_orders() from public;
grant execute on function ops_qc.assignable_orders() to authenticated;

-- ── 3. seams ──────────────────────────────────────────────────────────────

-- A person on the QC team, new or corrected. Every field is the one the form
-- holds; an empty account email unlinks the account.
create or replace function ops_qc.save_qc_person(
  p_code text, p_name text, p_phone text default null, p_city text default null,
  p_note text default null, p_user_email text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare p ops_qc.qc_people; u ops_core.users; v_taken text; v_granted boolean := false; v_new boolean;
begin
  if not ops_qc.is_coordinator() then
    return ops_core.refused('qc','qc_person', p_code,'save',
      'not_permitted','Mengelola tim QC butuh akses koordinator QC.');
  end if;
  if nullif(btrim(p_name), '') is null then
    return ops_core.invalid('qc','qc_person', p_code,'save', 'name_required',
      'Namanya siapa?', jsonb_build_object('field','name'));
  end if;
  if nullif(btrim(p_code), '') is not null then
    select * into p from ops_qc.qc_people where code = upper(btrim(p_code));
    if not found then
      return ops_core.not_found('qc','qc_person', p_code,'save', format('Tidak ada QC %s.', p_code));
    end if;
  end if;

  if nullif(btrim(p_user_email), '') is not null then
    select * into u from ops_core.users where email = btrim(p_user_email)::ops_core.citext;
    if not found then
      return ops_core.invalid('qc','qc_person', p_code,'save', 'account_unknown',
        format('Belum ada akun ops %s. Minta IT membuatnya dulu, lalu tautkan di sini.', btrim(p_user_email)),
        jsonb_build_object('field','user_email'));
    end if;
    select x.code into v_taken from ops_qc.qc_people x where x.user_id = u.id and x.id is distinct from p.id;
    if v_taken is not null then
      return ops_core.conflict('qc','qc_person', p_code,'save', 'account_taken',
        format('Akun %s sudah tertaut ke %s.', u.email, v_taken), jsonb_build_object('code', v_taken));
    end if;
  end if;

  v_new := p.id is null;
  if v_new then
    insert into ops_qc.qc_people (name, phone, city, note, user_id, created_by)
    values (btrim(p_name), nullif(btrim(p_phone), ''), nullif(btrim(p_city), ''), nullif(btrim(p_note), ''), u.id, auth.uid())
    returning * into p;
  else
    update ops_qc.qc_people
       set name = btrim(p_name), phone = nullif(btrim(p_phone), ''), city = nullif(btrim(p_city), ''),
           note = nullif(btrim(p_note), ''), user_id = u.id, updated_at = now()
     where id = p.id
    returning * into p;
  end if;

  -- An account that can sign in but not see its assignment is a support call.
  if u.id is not null and not exists (select 1 from ops_core.user_modules g where g.user_id = u.id and g.module = 'qc') then
    insert into ops_core.user_modules (user_id, module, level, granted_by) values (u.id, 'qc', 'write', auth.uid());
    v_granted := true;
  end if;

  perform ops_core.emit('qc', case when v_new then 'qc.person.added' else 'qc.person.updated' end, p.code,
    jsonb_build_object('code', p.code, 'name', p.name, 'account', u.email, 'granted_qc_write', v_granted));
  return ops_core.ok('qc','qc_person', p.code, case when v_new then 'add' else 'update' end,
    jsonb_build_object('code', p.code, 'granted_qc_write', v_granted));
end $$;
revoke all on function ops_qc.save_qc_person(text, text, text, text, text, text) from public;
grant execute on function ops_qc.save_qc_person(text, text, text, text, text, text) to authenticated;

-- Off the team, or back on it. Switching somebody off with live assignments
-- is allowed and said (A6): the coordinator may be about to reassign them.
create or replace function ops_qc.set_qc_person_active(p_code text, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare p ops_qc.qc_people; n int;
begin
  if not ops_qc.is_coordinator() then
    return ops_core.refused('qc','qc_person', p_code,'set_active',
      'not_permitted','Mengelola tim QC butuh akses koordinator QC.');
  end if;
  select * into p from ops_qc.qc_people where code = upper(btrim(p_code));
  if not found then
    return ops_core.not_found('qc','qc_person', p_code,'set_active', format('Tidak ada QC %s.', p_code));
  end if;
  if p.is_active = p_active then
    return ops_core.noop('qc','qc_person', p.code,'set_active', 'sudah begitu', jsonb_build_object('is_active', p_active));
  end if;
  if not p_active and nullif(btrim(p_reason), '') is null then
    return ops_core.invalid('qc','qc_person', p.code,'set_active', 'reason_required',
      'Kenapa dinonaktifkan? Alasannya dibaca saat evaluasi.', jsonb_build_object('field','reason'));
  end if;
  update ops_qc.qc_people
     set is_active = p_active, inactive_reason = case when p_active then null else btrim(p_reason) end, updated_at = now()
   where id = p.id;
  select count(*) into n from ops_qc.qc_assignments a
   where a.person_id = p.id and a.cancelled_at is null and (a.ends_on is null or a.ends_on >= ops_core.office_day());
  perform ops_core.emit('qc','qc.person.active', p.code,
    jsonb_build_object('code', p.code, 'is_active', p_active, 'reason', p_reason, 'live_assignments', n));
  return ops_core.ok('qc','qc_person', p.code,'set_active',
    jsonb_build_object('code', p.code, 'is_active', p_active,
                       'warnings', case when not p_active and n > 0
                                        then jsonb_build_array(format('%s masih punya %s penugasan berjalan.', p.name, n))
                                        else '[]'::jsonb end));
end $$;
revoke all on function ops_qc.set_qc_person_active(text, boolean, text) from public;
grant execute on function ops_qc.set_qc_person_active(text, boolean, text) to authenticated;

-- A person on a factory order, from a date (until a date, when known).
create or replace function ops_qc.assign_qc(
  p_person_code text, p_po_no text, p_starts_on date, p_ends_on date default null,
  p_note text default null, p_key text default null)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_procure, ops_core, pg_temp
as $$
declare p ops_qc.qc_people; po ops_procure.purchase_orders; v_no text; v_others text; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('qc','assign_qc', p_key);
  if replayed is not null then return replayed; end if;
  if not ops_qc.is_coordinator() then
    return ops_core.refused('qc','qc_assignment', null,'assign',
      'not_permitted','Menugaskan QC butuh akses koordinator QC.');
  end if;
  select * into p from ops_qc.qc_people where code = upper(btrim(p_person_code));
  if not found then
    return ops_core.invalid('qc','qc_assignment', null,'assign', 'person_unknown',
      format('Tidak ada QC %s.', coalesce(p_person_code, '—')), jsonb_build_object('field','person_code'));
  end if;
  if not p.is_active then
    return ops_core.conflict('qc','qc_assignment', null,'assign', 'person_inactive',
      format('%s sedang nonaktif.', p.name));
  end if;
  select * into po from ops_procure.purchase_orders where po_no = btrim(p_po_no);
  if not found then
    return ops_core.invalid('qc','qc_assignment', null,'assign', 'order_unknown',
      format('Tidak ada order %s.', coalesce(p_po_no, '—')), jsonb_build_object('field','po_no'));
  end if;
  if po.project_id is null then
    return ops_core.invalid('qc','qc_assignment', null,'assign', 'not_factory_order',
      format('%s bukan order pabrik — QC memantau order pabrik sebuah proyek.', po.po_no), jsonb_build_object('field','po_no'));
  end if;
  if po.status in ('CANCELLED','CLOSED') then
    return ops_core.conflict('qc','qc_assignment', null,'assign', 'order_closed',
      format('%s sudah %s.', po.po_no, case po.status when 'CANCELLED' then 'dibatalkan' else 'ditutup' end));
  end if;
  if p_starts_on is null then
    return ops_core.invalid('qc','qc_assignment', null,'assign', 'start_required',
      'Mulai tanggal berapa?', jsonb_build_object('field','starts_on'));
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    return ops_core.invalid('qc','qc_assignment', null,'assign', 'end_before_start',
      'Selesai tidak bisa sebelum mulai.', jsonb_build_object('field','ends_on'));
  end if;
  if exists (select 1 from ops_qc.qc_assignments a where a.person_id = p.id and a.po_id = po.id and a.cancelled_at is null) then
    return ops_core.conflict('qc','qc_assignment', null,'assign', 'already_assigned',
      format('%s sudah ditugaskan di %s.', p.name, po.po_no));
  end if;

  v_no := ops_core.next_doc_number('qca');
  insert into ops_qc.qc_assignments (assign_no, person_id, po_id, starts_on, ends_on, note, created_by)
  values (v_no, p.id, po.id, p_starts_on, p_ends_on, nullif(btrim(p_note), ''), auth.uid());

  -- Who else watches this order — said, never refused (the ratio is the
  -- coordinator's, D414).
  select string_agg(x.name, ', ' order by x.name) into v_others
    from ops_qc.qc_assignments a join ops_qc.qc_people x on x.id = a.person_id
   where a.po_id = po.id and a.cancelled_at is null and x.id <> p.id;

  perform ops_core.emit('qc','qc.assigned', v_no,
    jsonb_build_object('assign_no', v_no, 'person', p.code, 'po_no', po.po_no, 'starts_on', p_starts_on, 'ends_on', p_ends_on));
  res := ops_core.ok('qc','qc_assignment', v_no,'assign',
    jsonb_build_object('assign_no', v_no, 'person', p.code, 'po_no', po.po_no,
                       'account_linked', p.user_id is not null, 'others_on_order', v_others));
  return ops_core.idem_remember('qc','assign_qc', p_key, res);
end $$;
revoke all on function ops_qc.assign_qc(text, text, date, date, text, text) from public;
grant execute on function ops_qc.assign_qc(text, text, date, date, text, text) to authenticated;

-- The day an assignment ends — set when it is known, moved when it moves.
create or replace function ops_qc.end_qc_assignment(p_assign_no text, p_ends_on date)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare a ops_qc.qc_assignments;
begin
  if not ops_qc.is_coordinator() then
    return ops_core.refused('qc','qc_assignment', p_assign_no,'end',
      'not_permitted','Mengubah penugasan QC butuh akses koordinator QC.');
  end if;
  select * into a from ops_qc.qc_assignments where assign_no = btrim(p_assign_no);
  if not found then
    return ops_core.not_found('qc','qc_assignment', p_assign_no,'end', format('Tidak ada penugasan %s.', p_assign_no));
  end if;
  if a.cancelled_at is not null then
    return ops_core.conflict('qc','qc_assignment', a.assign_no,'end', 'cancelled', 'Penugasan ini sudah dibatalkan.');
  end if;
  if p_ends_on is not null and p_ends_on < a.starts_on then
    return ops_core.invalid('qc','qc_assignment', a.assign_no,'end', 'end_before_start',
      'Selesai tidak bisa sebelum mulai.', jsonb_build_object('field','ends_on'));
  end if;
  if a.ends_on is not distinct from p_ends_on then
    return ops_core.noop('qc','qc_assignment', a.assign_no,'end', 'tanggalnya sudah itu', '{}'::jsonb);
  end if;
  update ops_qc.qc_assignments set ends_on = p_ends_on where id = a.id;
  perform ops_core.emit('qc','qc.assignment.ends', a.assign_no,
    jsonb_build_object('assign_no', a.assign_no, 'from', a.ends_on, 'to', p_ends_on));
  return ops_core.ok('qc','qc_assignment', a.assign_no,'end', jsonb_build_object('assign_no', a.assign_no, 'ends_on', p_ends_on));
end $$;
revoke all on function ops_qc.end_qc_assignment(text, date) from public;
grant execute on function ops_qc.end_qc_assignment(text, date) to authenticated;

-- A wrong assignment, cancelled with a reason — never deleted, so the
-- evaluation (O9) reads who was sent where, including the mistakes.
create or replace function ops_qc.cancel_qc_assignment(p_assign_no text, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
declare a ops_qc.qc_assignments;
begin
  if not ops_qc.is_coordinator() then
    return ops_core.refused('qc','qc_assignment', p_assign_no,'cancel',
      'not_permitted','Membatalkan penugasan QC butuh akses koordinator QC.');
  end if;
  select * into a from ops_qc.qc_assignments where assign_no = btrim(p_assign_no);
  if not found then
    return ops_core.not_found('qc','qc_assignment', p_assign_no,'cancel', format('Tidak ada penugasan %s.', p_assign_no));
  end if;
  if a.cancelled_at is not null then
    return ops_core.conflict('qc','qc_assignment', a.assign_no,'cancel', 'already_cancelled', 'Penugasan ini sudah dibatalkan.');
  end if;
  if nullif(btrim(p_reason), '') is null then
    return ops_core.invalid('qc','qc_assignment', a.assign_no,'cancel', 'reason_required',
      'Kenapa dibatalkan?', jsonb_build_object('field','reason'));
  end if;
  update ops_qc.qc_assignments
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   where id = a.id;
  perform ops_core.emit('qc','qc.assignment.cancelled', a.assign_no,
    jsonb_build_object('assign_no', a.assign_no, 'reason', btrim(p_reason)));
  return ops_core.ok('qc','qc_assignment', a.assign_no,'cancel', jsonb_build_object('assign_no', a.assign_no));
end $$;
revoke all on function ops_qc.cancel_qc_assignment(text, text) from public;
grant execute on function ops_qc.cancel_qc_assignment(text, text) to authenticated;

-- ── 4. views ──────────────────────────────────────────────────────────────

-- The `qc` level an account holds, for the coordinator who linked it (or the
-- account itself): `user_modules` is IT's to read, and this is the one row of
-- it the coordinator needs.
create or replace function ops_qc.account_qc_level(p_user_id uuid)
returns text
language sql stable security definer
set search_path = ops_qc, ops_core, pg_temp
as $$
  select g.level::text from ops_core.user_modules g
   where g.user_id = p_user_id and g.module = 'qc'
     and (ops_qc.sees_all() or p_user_id = auth.uid())
$$;
revoke all on function ops_qc.account_qc_level(uuid) from public;
grant execute on function ops_qc.account_qc_level(uuid) to authenticated;

-- The team, with the account each signs in with and how many orders each is
-- on right now.
create or replace view ops_qc.v_qc_person with (security_invoker = on) as
select p.id, p.code, p.name, p.phone, p.city, p.user_id, p.is_active, p.inactive_reason, p.note,
       p.created_at, p.updated_at,
       u.email::text as account_email,
       ops_qc.account_qc_level(p.user_id) as account_qc_level,
       (select count(*)::int from ops_qc.qc_assignments a
         where a.person_id = p.id and a.cancelled_at is null
           and a.starts_on <= ops_core.office_day()
           and (a.ends_on is null or a.ends_on >= ops_core.office_day())) as active_assignments,
       (select count(*)::int from ops_qc.qc_assignments a
         where a.person_id = p.id and a.cancelled_at is null) as total_assignments
  from ops_qc.qc_people p
  left join ops_core.users u on u.id = p.user_id;

-- Every assignment a reader may see, with its person and its order.
--   state  PLANNED (starts later) · ACTIVE · ENDED · CANCELLED
create or replace view ops_qc.v_qc_assignment with (security_invoker = on) as
select a.id, a.assign_no, a.starts_on, a.ends_on, a.note, a.created_at,
       a.cancelled_at, a.cancel_reason,
       p.code as person_code, p.name as person_name, p.phone as person_phone, p.city as person_city,
       p.user_id = auth.uid() as is_mine,
       o.po_no, o.po_status, o.vendor_name, o.vendor_address, o.project_code, o.project_name, o.client_name,
       o.expected_delivery, o.issued_at, o.line_count, o.container_count,
       case when a.cancelled_at is not null then 'CANCELLED'
            when a.starts_on > ops_core.office_day() then 'PLANNED'
            when a.ends_on is not null and a.ends_on < ops_core.office_day() then 'ENDED'
            else 'ACTIVE' end as state
  from ops_qc.qc_assignments a
  join ops_qc.qc_people p on p.id = a.person_id
  left join lateral ops_qc.order_of(a.po_id) o on true;

grant select on ops_qc.v_qc_person, ops_qc.v_qc_assignment to authenticated;

analyze ops_qc.qc_people;
analyze ops_qc.qc_assignments;
