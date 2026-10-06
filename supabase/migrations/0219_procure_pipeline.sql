-- 0219_procure_pipeline.sql — the pipeline: who sells, where a lead came from,
-- what it may be worth, and why a sale did not happen (P2, kajian F224).
--
-- ── The owner's answers this builds on ────────────────────────────────────
--
--   D375  sales are recorded and read by leadership and **everybody with
--         marketing access** — *pimpinan dan semua yang punya akses ke
--         marketing*. Until now every sales seam asked for `project.*`.
--   D376  where a lead came from is free text for now: *belum terpikirkan,
--         karena kita masih belum menemukan model bisnis baru yang
--         tervalidasi*. No list until the data shows one.
--   D377  why a sale did not happen is a category, in English, **and** a
--         sentence: PRICE · TIMELINE · DESIGN · COMPETITOR · CLIENT POSTPONED ·
--         NO RESPONSE · OTHER.
--
-- ── What changes ──────────────────────────────────────────────────────────
--
-- 1. `may_sell(level)`: project or marketing access at that level. Every
--    sales seam asks it instead of `project.*` — clients, the contact log,
--    quotations, a project's facts and status. Order lines stay `project.*`:
--    they are what production makes, not what sales says.
-- 2. Reading follows: quotations, their lines, the contact log and the client
--    master are readable with `marketing.read` too. Cost and margin on a
--    quotation stay with `project.update` (0133), untouched here.
-- 3. A project carries its sale: the salesperson (an account, not a typed
--    name — `pic` stays the project's own person in charge), where it came
--    from, what it may be worth and when it may close. Written by its own
--    seam, `set_project_sales`, so an older screen saving the project's
--    facts can never blank them.
-- 4. Closing says why. `LOST` (0218) only before the deal, `CANCELLED` only
--    after it; both need a category and a sentence. Every move is logged as
--    before; a project can still be reopened.
-- 5. `v_project` reads all of it, plus how long the project has sat where it
--    is and the quotation in play.
--
-- ── Applying this to production ───────────────────────────────────────────
--
-- One signature changes (`set_project_status` gains `p_reason_code`). As in
-- 0217 (F220): there, run its `drop function` as `alter function … rename to
-- set_project_status_retired_0219` + `revoke all … from public, anon,
-- authenticated`. Everything else is `create or replace` or `alter policy`.

-- ── 1. who may sell ───────────────────────────────────────────────────────

create or replace function ops_procure.may_sell(p_level text)
returns boolean
language sql stable set search_path = ops_procure, ops_core, pg_temp as $$
  select ops_core.has_permission('project.' || p_level)
      or ops_core.has_permission('marketing.' || p_level);
$$;
revoke all on function ops_procure.may_sell(text) from public;
grant execute on function ops_procure.may_sell(text) to authenticated;

comment on function ops_procure.may_sell(text) is
  'Project or marketing access at this level (read, update, create): who sells (D375). (0219)';

-- ── 2. reading follows ────────────────────────────────────────────────────

alter policy quotations_read on ops_procure.quotations
  using (ops_core.has_permission('project.read') or ops_core.has_permission('marketing.read'));
alter policy qlines_read on ops_procure.quotation_lines
  using (ops_core.has_permission('project.read') or ops_core.has_permission('marketing.read'));
alter policy client_activities_read on ops_procure.client_activities
  using (ops_core.has_permission('project.read') or ops_core.has_permission('marketing.read'));
alter policy clients_read on ops_procure.clients
  using (ops_core.has_permission('project.read')
         or ops_core.has_permission('procurement.read')
         or ops_core.has_permission('production.read')
         or ops_core.has_permission('marketing.read'));

-- ── 3. a project carries its sale ─────────────────────────────────────────

alter table ops_procure.projects
  add column if not exists sales_pic          uuid references ops_core.users(id),
  add column if not exists source_note        text,
  add column if not exists expected_value     numeric
    constraint expected_value_not_negative check (expected_value is null or expected_value >= 0),
  add column if not exists expected_close_on  date;

comment on column ops_procure.projects.sales_pic is 'Who sells it: an account (D375). `pic` is the project''s own person in charge. (0219)';
comment on column ops_procure.projects.source_note is 'Where the lead came from, in words; no list yet (D376). (0219)';
comment on column ops_procure.projects.expected_value is 'What it may be worth before a quotation says so. (0219)';
comment on column ops_procure.projects.expected_close_on is 'When the sale is expected to close. (0219)';

create or replace function ops_procure.set_project_sales(
  p_code text,
  p_sales_pic uuid default null,
  p_source_note text default null,
  p_expected_value numeric default null,
  p_expected_close_on date default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','project', p_code,'set_sales',
      'not_permitted','Mengubah data penjualan butuh akses proyek atau marketing (update).');
  end if;
  select * into pr from ops_procure.projects where code = btrim(coalesce(p_code, ''));
  if not found then
    return ops_core.not_found('project','project', p_code,'set_sales', format('Tidak ada proyek %s.', p_code));
  end if;
  if p_expected_value is not null and p_expected_value < 0 then
    return ops_core.invalid('project','project', p_code,'set_sales',
      'negative_value','Perkiraan nilai tidak bisa negatif.', jsonb_build_object('field','expected_value'));
  end if;
  if p_sales_pic is not null
     and not exists (select 1 from ops_core.users u where u.id = p_sales_pic and u.is_active) then
    return ops_core.invalid('project','project', p_code,'set_sales',
      'sales_pic_unknown','PIC sales harus akun yang aktif.', jsonb_build_object('field','sales_pic'));
  end if;

  update ops_procure.projects set
    sales_pic = p_sales_pic,
    source_note = nullif(btrim(p_source_note), ''),
    expected_value = p_expected_value,
    expected_close_on = p_expected_close_on,
    updated_at = now()
  where id = pr.id;

  return ops_core.ok('project','project', pr.code,'set_sales', jsonb_build_object('code', pr.code),
    jsonb_build_object('sales_pic', pr.sales_pic, 'source_note', pr.source_note,
                       'expected_value', pr.expected_value, 'expected_close_on', pr.expected_close_on),
    jsonb_build_object('sales_pic', p_sales_pic, 'source_note', nullif(btrim(p_source_note), ''),
                       'expected_value', p_expected_value, 'expected_close_on', p_expected_close_on));
end $$;
revoke all on function ops_procure.set_project_sales(text, uuid, text, numeric, date) from public;
grant execute on function ops_procure.set_project_sales(text, uuid, text, numeric, date) to authenticated;

-- Who can be named as the salesperson: an active account that may write
-- sales. Asked by the picker; answers nobody who may not read sales.
create or replace function ops_procure.sales_people()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = ops_procure, ops_core, pg_temp as $$
  select u.id, u.full_name, u.email
    from ops_core.users u
   where u.is_active
     and ops_procure.may_sell('read')
     and exists (select 1 from ops_core.user_modules g
                  where g.user_id = u.id and g.module::text in ('project','marketing')
                    and g.level::text in ('write','admin'))
   order by u.full_name;
$$;
revoke all on function ops_procure.sales_people() from public;
grant execute on function ops_procure.sales_people() to authenticated;

-- ── 4. closing says why ───────────────────────────────────────────────────

alter table ops_procure.project_status_log
  add column if not exists reason_code text
    constraint reason_code_known check (reason_code is null or reason_code in
      ('PRICE','TIMELINE','DESIGN','COMPETITOR','CLIENT POSTPONED','NO RESPONSE','OTHER'));

-- New closings only: the cancellations already logged said why in words and
-- are not given a category nobody chose.
alter table ops_procure.project_status_log
  add constraint closing_says_why check (
    to_status not in ('LOST','CANCELLED')
    or (reason_code is not null and reason is not null and length(btrim(reason)) > 0)) not valid;

drop function if exists ops_procure.set_project_status(text, text, text);

-- Where the order stands. Any status can follow any other — a lost sale can be
-- reopened, an order can go back from *deal* to *quotation* — and every move
-- is logged. Closing is the exception that is checked: LOST before the deal,
-- CANCELLED after it, and both say why (D377).
create or replace function ops_procure.set_project_status(
  p_code text, p_status text, p_reason text default null, p_reason_code text default null)
returns jsonb
language plpgsql security definer set search_path = ops_procure, ops_core, pg_temp as $$
declare pr ops_procure.projects; v_to ops_procure.project_status_t;
        v_code text := nullif(upper(btrim(p_reason_code)), '');
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','project', p_code,'set_status',
      'not_permitted','Mengubah status proyek butuh akses proyek atau marketing (update).');
  end if;
  select * into pr from ops_procure.projects where code = p_code;
  if not found then
    return ops_core.not_found('project','project', p_code,'set_status', format('Tidak ada proyek %s.', p_code));
  end if;
  begin
    v_to := p_status::ops_procure.project_status_t;
  exception when invalid_text_representation then
    return ops_core.invalid('project','project', p_code,'set_status',
      'unknown_status', format('"%s" bukan status proyek.', p_status), jsonb_build_object('field','status'));
  end;
  if v_to = pr.status then
    return ops_core.noop('project','project', p_code,'set_status','Statusnya sudah itu.',
      jsonb_build_object('code', p_code, 'status', v_to));
  end if;

  if v_to = 'LOST' and pr.status not in ('INQUIRY','QUOTATION_SENT') then
    return ops_core.invalid('project','project', p_code,'set_status',
      'lost_after_deal',
      'Proyek ini sudah deal. Kalau tidak jadi, catat sebagai CANCELLED (batal setelah deal), bukan LOST.',
      jsonb_build_object('field','status','from', pr.status));
  end if;
  if v_to = 'CANCELLED' and pr.status in ('INQUIRY','QUOTATION_SENT','LOST') then
    return ops_core.invalid('project','project', p_code,'set_status',
      'cancel_before_deal',
      'Proyek ini belum deal. Kalau tidak jadi, catat sebagai LOST (tidak jadi), bukan CANCELLED.',
      jsonb_build_object('field','status','from', pr.status));
  end if;
  if v_to in ('LOST','CANCELLED') then
    if v_code is null then
      return ops_core.invalid('project','project', p_code,'set_status',
        'reason_code_required','Pilih alasannya: PRICE, TIMELINE, DESIGN, COMPETITOR, CLIENT POSTPONED, NO RESPONSE atau OTHER.',
        jsonb_build_object('field','reason_code'));
    end if;
    if v_code not in ('PRICE','TIMELINE','DESIGN','COMPETITOR','CLIENT POSTPONED','NO RESPONSE','OTHER') then
      return ops_core.invalid('project','project', p_code,'set_status',
        'unknown_reason_code', format('"%s" bukan kategori alasan.', p_reason_code),
        jsonb_build_object('field','reason_code','given', p_reason_code));
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      return ops_core.invalid('project','project', p_code,'set_status',
        'reason_required','Tulis satu kalimat: apa yang dikatakan klien. Kategori menjawab berapa banyak, kalimat menjawab kenapa yang ini.',
        jsonb_build_object('field','reason'));
    end if;
  end if;

  update ops_procure.projects
     set status = v_to, status_changed_at = now(), updated_at = now(),
         is_active = v_to not in ('DONE','CANCELLED','LOST')
   where id = pr.id;
  insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, reason_code, changed_by)
  values (pr.id, pr.status, v_to, nullif(btrim(p_reason), ''),
          case when v_to in ('LOST','CANCELLED') then v_code end, auth.uid());
  return ops_core.ok('project','project', p_code,'set_status',
    jsonb_build_object('code', p_code, 'status', v_to), to_jsonb(pr.status), to_jsonb(v_to));
end $$;
revoke all on function ops_procure.set_project_status(text, text, text, text) from public;
grant execute on function ops_procure.set_project_status(text, text, text, text) to authenticated;

-- ── 5. what the screens read ──────────────────────────────────────────────

-- The columns of 0111 named one by one (`p.*` would put the new project
-- columns in the middle), then the sale.
create or replace view ops_procure.v_project as
select
  p.id, p.code, p.name, p.is_active, p.client_name, p.location, p.pic, p.started_on,
  p.target_date, p.contract_value, p.note, p.created_by, p.created_at, p.client_id,
  p.status, p.status_changed_at, p.updated_at,
  c.code                                                    as client_code,
  coalesce(c.name, p.client_name)                           as client_display,
  c.contact_name                                            as client_contact,
  c.phone                                                   as client_phone,
  coalesce(ls.lines, 0)                                     as line_count,
  coalesce(ls.unlinked, 0)                                  as lines_without_item_code,
  ls.order_value,
  coalesce(ls.unpriced, 0)                                  as unpriced_lines,
  ls.next_delivery,
  p.sales_pic,
  su.full_name                                              as sales_pic_name,
  su.email                                                  as sales_pic_email,
  p.source_note,
  p.expected_value,
  p.expected_close_on,
  (ops_core.office_day()
     - (coalesce(p.status_changed_at, p.created_at) at time zone ops_core.office_tz())::date)::int
                                                            as days_in_status,
  cq.quote_no                                               as current_quote_no,
  cq.status::text                                           as current_quote_status,
  cq.grand_total                                            as current_quote_total,
  cl.reason_code                                            as closing_reason_code,
  cl.reason                                                 as closing_reason,
  cl.changed_at                                             as closed_at
from ops_procure.projects p
left join ops_procure.clients c on c.id = p.client_id
left join ops_core.users su on su.id = p.sales_pic
left join lateral (
  select count(*)::int                                           as lines,
         count(*) filter (where l.product_code is null)::int     as unlinked,
         case when count(*) filter (where l.unit_price is not null) = 0 then null
              else sum(l.qty * l.unit_price) filter (where l.unit_price is not null) end as order_value,
         count(*) filter (where l.unit_price is null)::int       as unpriced,
         min(l.delivery_date)                                    as next_delivery
    from ops_procure.project_lines l where l.project_id = p.id
) ls on true
left join lateral (
  select q.quote_no, q.status, q.grand_total
    from ops_procure.v_quotation q
   where q.project_id = p.id and q.is_current
   order by q.rev desc limit 1
) cq on true
left join lateral (
  select g.reason_code, g.reason, g.changed_at
    from ops_procure.project_status_log g
   where g.project_id = p.id and g.to_status = p.status and p.status in ('LOST','CANCELLED')
   order by g.changed_at desc limit 1
) cl on true;
alter view ops_procure.v_project set (security_invoker = on);

-- ── 6. the sales seams, opened to marketing (D375) ────────────────────────
--
-- The bodies of 0111, 0133 and 0134 as they stand, with one change each: the
-- gate asks `may_sell` where it asked `project.*`, and the refusal says so.

CREATE OR REPLACE FUNCTION ops_procure.archive_client(p_code text, p_archived boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare c ops_procure.clients;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','client', p_code,'archive',
      'not_permitted','Mengarsipkan klien butuh akses proyek atau marketing (update).');
  end if;
  select * into c from ops_procure.clients where code = p_code;
  if not found then
    return ops_core.not_found('project','client', p_code,'archive', format('Tidak ada klien %s.', p_code));
  end if;
  if (c.archived_at is not null) = p_archived then
    return ops_core.noop('project','client', p_code,'archive','Sudah begitu.', jsonb_build_object('code', p_code));
  end if;
  update ops_procure.clients
     set archived_at = case when p_archived then now() end,
         archived_by = case when p_archived then auth.uid() end
   where id = c.id;
  return ops_core.ok('project','client', p_code, case when p_archived then 'archive' else 'restore' end,
    jsonb_build_object('code', p_code));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.complete_follow_up(p_activity_id uuid, p_result text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare a ops_procure.client_activities;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','client_activity', null,'follow_up',
      'not_permitted','Menutup follow-up butuh akses proyek atau marketing (update).');
  end if;
  select * into a from ops_procure.client_activities where id = p_activity_id;
  if not found then
    return ops_core.not_found('project','client_activity', null,'follow_up', 'Aktivitas itu tidak ada.');
  end if;
  if a.follow_up_on is null then
    return ops_core.invalid('project','client_activity', null,'follow_up', 'no_follow_up',
      'Aktivitas ini tidak punya follow-up.', jsonb_build_object('field','follow_up_on'));
  end if;
  if a.follow_up_done_at is not null then
    return ops_core.noop('project','client_activity', null,'follow_up', 'Sudah ditutup.', jsonb_build_object('id', a.id));
  end if;
  update ops_procure.client_activities
     set follow_up_done_at = now(), follow_up_done_by = auth.uid(), follow_up_result = nullif(btrim(p_result), '')
   where id = a.id;
  return ops_core.ok('project','client_activity', null,'follow_up', jsonb_build_object('id', a.id));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.decide_quotation(p_quote_no text, p_accepted boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; pr ops_procure.projects; v_next int; v_added int := 0;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'decide',
      'not_permitted','Mencatat jawaban klien butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'decide', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'SENT' then
    return ops_core.conflict('project','quotation', p_quote_no,'decide', 'not_sent',
      case q.status when 'DRAFT' then 'Belum dikirim ke klien.'
                    else format('%s sudah %s.', q.quote_no, q.status) end);
  end if;
  if not p_accepted and coalesce(btrim(p_reason), '') = '' then
    return ops_core.invalid('project','quotation', p_quote_no,'decide', 'reason_required',
      'Kenapa ditolak? Harga, waktu, atau desain — pertanyaan ini pasti datang lagi di penawaran berikutnya.',
      jsonb_build_object('field','reason'));
  end if;

  update ops_procure.quotations
     set status = case when p_accepted then 'ACCEPTED'::ops_procure.quotation_status_t else 'REJECTED' end,
         decided_at = now(), decided_by = auth.uid(), decision_reason = nullif(btrim(p_reason), ''), updated_at = now()
   where id = q.id;

  select * into pr from ops_procure.projects where id = q.project_id;
  if p_accepted then
    select coalesce(max(line_no), 0) into v_next from ops_procure.project_lines where project_id = pr.id;
    insert into ops_procure.project_lines (project_id, line_no, product_code, description, qty, uom, unit_price,
                                           note, quotation_line_id)
    select pr.id, v_next + row_number() over (order by l.line_no), l.product_code, l.description, l.qty, l.uom,
           l.frozen_unit_price, format('dari %s', q.quote_no), l.id
      from ops_procure.quotation_lines l
     where l.quotation_id = q.id
       and not exists (select 1 from ops_procure.project_lines x where x.quotation_line_id = l.id);
    get diagnostics v_added = row_count;
    if pr.status in ('INQUIRY','QUOTATION_SENT') then
      update ops_procure.projects set status = 'DEAL', status_changed_at = now(), updated_at = now(), is_active = true
       where id = pr.id;
      insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
      values (pr.id, pr.status, 'DEAL', format('Quotation %s disetujui', q.quote_no), auth.uid());
    end if;
  end if;
  return ops_core.ok('project','quotation', q.quote_no, case when p_accepted then 'accept' else 'reject' end,
    jsonb_build_object('quote_no', q.quote_no, 'project_code', pr.code, 'order_lines_added', v_added));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.log_client_activity(p_client_code text, p_kind text, p_summary text, p_project_code text DEFAULT NULL::text, p_quote_no text DEFAULT NULL::text, p_happened_on date DEFAULT NULL::date, p_follow_up_on date DEFAULT NULL::date, p_next_action text DEFAULT NULL::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare c ops_procure.clients; pr ops_procure.projects; qt ops_procure.quotations;
        v_on date := coalesce(p_happened_on, ops_core.office_day()); v_id uuid; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('project', 'log_client_activity', p_key);
  if replayed is not null then return replayed; end if;

  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','client_activity', p_client_code,'create',
      'not_permitted','Mencatat aktivitas klien butuh akses proyek atau marketing (update).');
  end if;
  if coalesce(p_kind, '') not in ('call','whatsapp','email','meeting','visit','note') then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'bad_kind',
      'Jenisnya telepon, WhatsApp, email, meeting, kunjungan, atau catatan.', jsonb_build_object('field','kind'));
  end if;
  if coalesce(btrim(p_summary), '') = '' then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'summary_required',
      'Apa yang dibicarakan? Satu kalimat cukup.', jsonb_build_object('field','summary'));
  end if;
  if v_on > ops_core.office_day() then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'in_future',
      'Aktivitas dicatat setelah terjadi. Untuk rencana, pakai follow-up.', jsonb_build_object('field','happened_on'));
  end if;
  if p_follow_up_on is not null and p_follow_up_on < v_on then
    return ops_core.invalid('project','client_activity', p_client_code,'create', 'follow_up_before',
      'Follow-up tidak bisa sebelum aktivitasnya.', jsonb_build_object('field','follow_up_on'));
  end if;

  -- The quotation names its project; the project names its client. Each one
  -- given must agree with the one above it.
  if nullif(btrim(p_quote_no), '') is not null then
    select * into qt from ops_procure.quotations where quote_no = btrim(p_quote_no);
    if not found then
      return ops_core.not_found('project','client_activity', p_quote_no,'create', format('Tidak ada quotation %s.', p_quote_no));
    end if;
  end if;
  if nullif(btrim(p_project_code), '') is not null then
    select * into pr from ops_procure.projects where code = btrim(p_project_code);
    if not found then
      return ops_core.not_found('project','client_activity', p_project_code,'create', format('Tidak ada proyek %s.', p_project_code));
    end if;
    if qt.id is not null and qt.project_id <> pr.id then
      return ops_core.invalid('project','client_activity', p_quote_no,'create', 'quote_other_project',
        format('%s bukan quotation proyek %s.', qt.quote_no, pr.code), jsonb_build_object('field','quote_no'));
    end if;
  elsif qt.id is not null then
    select * into pr from ops_procure.projects where id = qt.project_id;
  end if;

  if nullif(btrim(p_client_code), '') is not null then
    select * into c from ops_procure.clients where code = btrim(p_client_code);
    if not found then
      return ops_core.not_found('project','client_activity', p_client_code,'create', format('Tidak ada klien %s.', p_client_code));
    end if;
    if pr.id is not null and pr.client_id is distinct from c.id then
      return ops_core.invalid('project','client_activity', pr.code,'create', 'project_other_client',
        format('Proyek %s bukan milik %s.', pr.code, c.name), jsonb_build_object('field','project_code'));
    end if;
  elsif pr.id is not null then
    select * into c from ops_procure.clients where id = pr.client_id;
    if not found then
      return ops_core.invalid('project','client_activity', pr.code,'create', 'no_client',
        format('Proyek %s belum punya klien. Pilih kliennya di proyek dulu.', pr.code), jsonb_build_object('field','client_code'));
    end if;
  else
    return ops_core.invalid('project','client_activity', null,'create', 'client_required',
      'Dengan klien siapa?', jsonb_build_object('field','client_code'));
  end if;

  insert into ops_procure.client_activities (client_id, project_id, quotation_id, kind, happened_on, summary,
                                             follow_up_on, next_action, created_by)
  values (c.id, pr.id, qt.id, p_kind, v_on, btrim(p_summary),
          p_follow_up_on, nullif(btrim(p_next_action), ''), auth.uid())
  returning id into v_id;
  res := ops_core.ok('project','client_activity', c.code,'create', jsonb_build_object('id', v_id));
  return ops_core.idem_remember('project', 'log_client_activity', p_key, res);
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.remove_quotation_line(p_quote_no text, p_line_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'remove_line',
      'not_permitted','Mengubah quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'remove_line', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'remove_line', 'not_draft',
      format('%s sudah %s. Buat revisi untuk mengubah isinya.', q.quote_no, q.status));
  end if;
  delete from ops_procure.quotation_lines where id = p_line_id and quotation_id = q.id;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'remove_line', 'Baris itu tidak ada.');
  end if;
  -- Numbers stay contiguous for the printed page.
  update ops_procure.quotation_lines l set line_no = r.n
    from (select id, row_number() over (order by line_no) as n from ops_procure.quotation_lines where quotation_id = q.id) r
   where l.id = r.id and l.line_no <> r.n;
  return ops_core.ok('project','quotation', q.quote_no,'remove_line', jsonb_build_object('quote_no', q.quote_no));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.revise_quotation(p_quote_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; n ops_procure.quotations; v_rev int;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'revise',
      'not_permitted','Merevisi quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'revise', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status not in ('SENT','REJECTED') then
    return ops_core.conflict('project','quotation', p_quote_no,'revise', 'not_revisable',
      case q.status when 'DRAFT' then 'Masih draft — ubah langsung saja.'
                    when 'ACCEPTED' then 'Sudah disetujui dan menjadi pesanan. Perubahan setelah ini diurus di pesanannya.'
                    else format('%s sudah %s.', q.quote_no, q.status) end);
  end if;
  if exists (select 1 from ops_procure.quotations where project_id = q.project_id and status = 'DRAFT') then
    return ops_core.conflict('project','quotation', p_quote_no,'revise', 'draft_exists',
      'Proyek ini sudah punya quotation draft.');
  end if;
  select coalesce(max(rev), 0) + 1 into v_rev from ops_procure.quotations where project_id = q.project_id;
  insert into ops_procure.quotations (project_id, rev, supersedes_id, valid_until, marketing_pct, overhead_pct,
                                      margin_pct, vat, vat_pct, terms, note, created_by)
  values (q.project_id, v_rev, q.id, greatest(coalesce(q.valid_until, ops_core.office_day()), ops_core.office_day() + 30),
          q.marketing_pct, q.overhead_pct, q.margin_pct, q.vat, q.vat_pct, q.terms, q.note, auth.uid())
  returning * into n;
  insert into ops_procure.quotation_lines (quotation_id, line_no, product_code, description, qty, uom, lead_time_days,
    manual_unit_cost, marketing_pct, overhead_pct, margin_pct, unit_price_override, note)
  select n.id, line_no, product_code, description, qty, uom, lead_time_days,
         manual_unit_cost, marketing_pct, overhead_pct, margin_pct, unit_price_override, note
    from ops_procure.quotation_lines where quotation_id = q.id;
  if q.status = 'SENT' then
    update ops_procure.quotations set status = 'SUPERSEDED', updated_at = now() where id = q.id;
  end if;
  return ops_core.ok('project','quotation', n.quote_no,'revise',
    jsonb_build_object('quote_no', n.quote_no, 'rev', n.rev, 'from', q.quote_no));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.save_client(p_code text, p_name text, p_contact_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_npwp text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare c ops_procure.clients; v_name text := btrim(coalesce(p_name, '')); v_code text; n int;
begin
  if v_name = '' then
    return ops_core.invalid('project','client', p_code,'save',
      'name_required','Nama kliennya siapa?', jsonb_build_object('field','name'));
  end if;

  if p_code is null or btrim(p_code) = '' then
    if not ops_procure.may_sell('create') then
      return ops_core.refused('project','client', null,'create',
        'not_permitted','Menambah klien butuh akses proyek atau marketing (create).');
    end if;
    select * into c from ops_procure.clients
     where lower(btrim(name)) = lower(v_name) and archived_at is null;
    if found then
      return ops_core.conflict('project','client', c.code,'create',
        'client_exists', format('%s sudah ada sebagai %s.', c.name, c.code),
        jsonb_build_object('code', c.code));
    end if;
    select count(*) + 1 into n from ops_procure.clients;
    v_code := 'CL-' || lpad(n::text, 4, '0');
    while exists (select 1 from ops_procure.clients x where x.code = v_code) loop
      n := n + 1; v_code := 'CL-' || lpad(n::text, 4, '0');
    end loop;
    insert into ops_procure.clients (code, name, contact_name, phone, email, address, npwp, note, created_by)
    values (v_code, v_name, nullif(btrim(p_contact_name), ''), nullif(btrim(p_phone), ''),
            nullif(btrim(p_email), ''), nullif(btrim(p_address), ''), nullif(btrim(p_npwp), ''),
            nullif(btrim(p_note), ''), auth.uid());
    return ops_core.ok('project','client', v_code,'create', jsonb_build_object('code', v_code));
  end if;

  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','client', p_code,'update',
      'not_permitted','Mengubah klien butuh akses proyek atau marketing (update).');
  end if;
  select * into c from ops_procure.clients where code = p_code;
  if not found then
    return ops_core.not_found('project','client', p_code,'update', format('Tidak ada klien %s.', p_code));
  end if;
  if exists (select 1 from ops_procure.clients x
              where lower(btrim(x.name)) = lower(v_name) and x.archived_at is null and x.id <> c.id) then
    return ops_core.conflict('project','client', p_code,'update',
      'client_exists', format('Sudah ada klien lain bernama %s.', v_name));
  end if;
  update ops_procure.clients set
    name = v_name,
    contact_name = nullif(btrim(p_contact_name), ''), phone = nullif(btrim(p_phone), ''),
    email = nullif(btrim(p_email), ''), address = nullif(btrim(p_address), ''),
    npwp = nullif(btrim(p_npwp), ''), note = nullif(btrim(p_note), ''),
    updated_at = now()
  where id = c.id;
  -- The name typed on each project follows, so every screen that still reads
  -- `projects.client_name` reads the new one.
  update ops_procure.projects set client_name = v_name where client_id = c.id;
  return ops_core.ok('project','client', p_code,'update', jsonb_build_object('code', p_code),
    to_jsonb(c), (select to_jsonb(x) from ops_procure.clients x where x.id = c.id));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.save_project(p_code text, p_name text, p_client_code text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_pic text DEFAULT NULL::text, p_started_on date DEFAULT NULL::date, p_target_date date DEFAULT NULL::date, p_contract_value numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare pr ops_procure.projects; c ops_procure.clients; v_code text := btrim(coalesce(p_code, ''));
        v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then
    return ops_core.invalid('project','project', v_code,'save',
      'name_required','Proyeknya dikenal dengan nama apa?', jsonb_build_object('field','name'));
  end if;
  if p_target_date is not null and p_started_on is not null and p_target_date < p_started_on then
    return ops_core.invalid('project','project', v_code,'save',
      'dates_reversed','Tanggal kirim lebih awal dari tanggal mulai.', jsonb_build_object('field','target_date'));
  end if;
  if p_contract_value is not null and p_contract_value < 0 then
    return ops_core.invalid('project','project', v_code,'save',
      'negative_value','Nilai kontrak tidak bisa negatif.', jsonb_build_object('field','contract_value'));
  end if;
  if coalesce(btrim(p_client_code), '') <> '' then
    select * into c from ops_procure.clients where code = btrim(p_client_code);
    if not found then
      return ops_core.invalid('project','project', v_code,'save',
        'client_unknown', format('Tidak ada klien %s.', p_client_code), jsonb_build_object('field','client_code'));
    end if;
  end if;

  if v_code <> '' then
    select * into pr from ops_procure.projects where code = v_code;
  end if;

  if pr.id is null then
    if not ops_procure.may_sell('create') then
      return ops_core.refused('project','project', v_code,'create',
        'not_permitted','Membuat proyek butuh akses proyek atau marketing (create).');
    end if;
    if v_code = '' then
      select coalesce(max(code::bigint), (to_char(now(), 'YY') || '000')::bigint) + 1
        into v_code from ops_procure.projects where code ~ '^[0-9]+$';
      v_code := coalesce(v_code, to_char(now(), 'YY') || '001');
    end if;
    insert into ops_procure.projects
      (code, name, client_id, client_name, location, pic, started_on, target_date,
       contract_value, note, status, status_changed_at, is_active, created_by)
    values (v_code, v_name, c.id, c.name, nullif(btrim(p_location), ''), nullif(btrim(p_pic), ''),
            p_started_on, p_target_date, p_contract_value, nullif(btrim(p_note), ''),
            'INQUIRY', now(), true, auth.uid())
    returning * into pr;
    insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
    values (pr.id, null, 'INQUIRY', 'proyek dibuat', auth.uid());
    return ops_core.ok('project','project', v_code,'create', jsonb_build_object('code', v_code));
  end if;

  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','project', v_code,'update',
      'not_permitted','Mengubah proyek butuh akses proyek atau marketing (update).');
  end if;
  update ops_procure.projects set
    name = v_name,
    client_id = c.id,
    client_name = c.name,
    location = nullif(btrim(p_location), ''),
    pic = nullif(btrim(p_pic), ''),
    started_on = p_started_on,
    target_date = p_target_date,
    contract_value = p_contract_value,
    note = nullif(btrim(p_note), ''),
    updated_at = now()
  where id = pr.id;
  return ops_core.ok('project','project', v_code,'update', jsonb_build_object('code', v_code),
    to_jsonb(pr), (select to_jsonb(x) from ops_procure.projects x where x.id = pr.id));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.save_quotation(p_quote_no text, p_project_code text DEFAULT NULL::text, p_valid_until date DEFAULT NULL::date, p_marketing_pct numeric DEFAULT 0, p_overhead_pct numeric DEFAULT 0, p_margin_pct numeric DEFAULT 0, p_vat boolean DEFAULT false, p_vat_pct numeric DEFAULT 11, p_terms text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; pr ops_procure.projects; v_rev int; res jsonb; replayed jsonb;
begin
  replayed := ops_core.idem_replay('project', 'save_quotation', p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(p_marketing_pct, 0) < 0 or coalesce(p_overhead_pct, 0) < 0 or coalesce(p_margin_pct, 0) < 0
     or coalesce(p_marketing_pct, 0) >= 100 or coalesce(p_overhead_pct, 0) >= 100 or coalesce(p_margin_pct, 0) >= 100 then
    return ops_core.invalid('project','quotation', p_quote_no,'save', 'bad_percent',
      'Persentase harus 0 sampai di bawah 100.', jsonb_build_object('field','margin_pct'));
  end if;

  if p_quote_no is null or btrim(p_quote_no) = '' then
    if not ops_procure.may_sell('create') then
      return ops_core.refused('project','quotation', null,'create',
        'not_permitted','Membuat quotation butuh akses proyek atau marketing (create).');
    end if;
    select * into pr from ops_procure.projects where code = p_project_code;
    if not found then
      return ops_core.not_found('project','quotation', null,'create', format('Tidak ada proyek %s.', p_project_code));
    end if;
    if exists (select 1 from ops_procure.quotations where project_id = pr.id and status = 'DRAFT') then
      return ops_core.conflict('project','quotation', null,'create', 'draft_exists',
        format('Proyek %s sudah punya quotation draft. Lanjutkan yang itu.', pr.code),
        jsonb_build_object('quote_no', (select quote_no from ops_procure.quotations where project_id = pr.id and status = 'DRAFT' limit 1)));
    end if;
    select coalesce(max(rev), 0) + 1 into v_rev from ops_procure.quotations where project_id = pr.id;
    insert into ops_procure.quotations (project_id, rev, valid_until, marketing_pct, overhead_pct, margin_pct,
                                        vat, vat_pct, terms, note, created_by)
    values (pr.id, v_rev, coalesce(p_valid_until, ops_core.office_day() + 30),
            coalesce(p_marketing_pct, 0), coalesce(p_overhead_pct, 0), coalesce(p_margin_pct, 0),
            coalesce(p_vat, false), coalesce(p_vat_pct, 11), nullif(btrim(p_terms), ''), nullif(btrim(p_note), ''), auth.uid())
    returning * into q;
    res := ops_core.ok('project','quotation', q.quote_no,'create', jsonb_build_object('quote_no', q.quote_no));
    return ops_core.idem_remember('project', 'save_quotation', p_key, res);
  end if;

  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'update',
      'not_permitted','Mengubah quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'update', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'update', 'not_draft',
      format('%s sudah %s — angka yang sudah dikirim tidak diubah. Buat revisi.', q.quote_no, q.status));
  end if;
  update ops_procure.quotations set
    valid_until = p_valid_until, marketing_pct = coalesce(p_marketing_pct, 0),
    overhead_pct = coalesce(p_overhead_pct, 0), margin_pct = coalesce(p_margin_pct, 0),
    vat = coalesce(p_vat, false), vat_pct = coalesce(p_vat_pct, 11),
    terms = nullif(btrim(p_terms), ''), note = nullif(btrim(p_note), ''), updated_at = now()
  where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,'update', jsonb_build_object('quote_no', q.quote_no));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.save_quotation_line(p_quote_no text, p_line_id uuid DEFAULT NULL::uuid, p_product_code text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_qty numeric DEFAULT NULL::numeric, p_uom text DEFAULT 'unit'::text, p_lead_time_days integer DEFAULT NULL::integer, p_manual_unit_cost numeric DEFAULT NULL::numeric, p_marketing_pct numeric DEFAULT NULL::numeric, p_overhead_pct numeric DEFAULT NULL::numeric, p_margin_pct numeric DEFAULT NULL::numeric, p_unit_price_override numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; v_code text := nullif(upper(btrim(coalesce(p_product_code, ''))), '');
        v_desc text := btrim(coalesce(p_description, '')); v_id uuid; v_no int; v_name text;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'save_line',
      'not_permitted','Mengubah quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'save_line', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'save_line', 'not_draft',
      format('%s sudah %s. Buat revisi untuk mengubah isinya.', q.quote_no, q.status));
  end if;
  if v_code is not null then
    select name into v_name from ops_prod.products where product_code = v_code;
    if v_name is null then
      return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'product_not_found',
        format('Tidak ada item code %s di katalog.', v_code), jsonb_build_object('field','product_code'));
    end if;
    if v_desc = '' then v_desc := v_name; end if;
  end if;
  if v_desc = '' then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'description_required',
      'Itemnya apa? Klien membaca baris ini.', jsonb_build_object('field','description'));
  end if;
  if p_qty is null or p_qty <= 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'qty_required',
      'Berapa unit?', jsonb_build_object('field','qty'));
  end if;
  if not exists (select 1 from ops_procure.uom where code = p_uom) then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'no_such_uom',
      format('Tidak ada satuan %s.', p_uom), jsonb_build_object('field','uom'));
  end if;
  if coalesce(p_manual_unit_cost, 0) < 0 or coalesce(p_unit_price_override, 0) < 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'negative',
      'Ongkos dan harga tidak bisa negatif.', jsonb_build_object('field','manual_unit_cost'));
  end if;
  if coalesce(p_marketing_pct, 0) not between 0 and 99.99 or coalesce(p_overhead_pct, 0) not between 0 and 99.99
     or coalesce(p_margin_pct, 0) not between 0 and 99.99 then
    return ops_core.invalid('project','quotation', p_quote_no,'save_line', 'bad_percent',
      'Persentase harus 0 sampai di bawah 100.', jsonb_build_object('field','margin_pct'));
  end if;

  if p_line_id is not null then
    update ops_procure.quotation_lines set
      product_code = v_code, description = v_desc, qty = p_qty, uom = p_uom,
      lead_time_days = p_lead_time_days, manual_unit_cost = p_manual_unit_cost,
      marketing_pct = p_marketing_pct, overhead_pct = p_overhead_pct, margin_pct = p_margin_pct,
      unit_price_override = p_unit_price_override, note = nullif(btrim(p_note), '')
    where id = p_line_id and quotation_id = q.id
    returning id into v_id;
    if v_id is null then
      return ops_core.not_found('project','quotation', p_quote_no,'save_line', 'Baris itu tidak ada.');
    end if;
  else
    select coalesce(max(line_no), 0) + 1 into v_no from ops_procure.quotation_lines where quotation_id = q.id;
    insert into ops_procure.quotation_lines
      (quotation_id, line_no, product_code, description, qty, uom, lead_time_days, manual_unit_cost,
       marketing_pct, overhead_pct, margin_pct, unit_price_override, note)
    values (q.id, v_no, v_code, v_desc, p_qty, p_uom, p_lead_time_days, p_manual_unit_cost,
            p_marketing_pct, p_overhead_pct, p_margin_pct, p_unit_price_override, nullif(btrim(p_note), ''))
    returning id into v_id;
  end if;
  update ops_procure.quotations set updated_at = now() where id = q.id;
  return ops_core.ok('project','quotation', q.quote_no,
    case when p_line_id is null then 'add_line' else 'update_line' end,
    jsonb_build_object('quote_no', q.quote_no, 'line_id', v_id));
end $function$;

CREATE OR REPLACE FUNCTION ops_procure.send_quotation(p_quote_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops_procure', 'ops_core', 'pg_temp'
AS $function$
declare q ops_procure.quotations; pr ops_procure.projects; v_missing text; v_n int;
begin
  if not ops_procure.may_sell('update') then
    return ops_core.refused('project','quotation', p_quote_no,'send',
      'not_permitted','Mengirim quotation butuh akses proyek atau marketing (update).');
  end if;
  select * into q from ops_procure.quotations where quote_no = p_quote_no;
  if not found then
    return ops_core.not_found('project','quotation', p_quote_no,'send', format('Tidak ada quotation %s.', p_quote_no));
  end if;
  if q.status <> 'DRAFT' then
    return ops_core.conflict('project','quotation', p_quote_no,'send', 'not_draft', format('%s sudah %s.', q.quote_no, q.status));
  end if;
  select count(*) into v_n from ops_procure.quotation_lines where quotation_id = q.id;
  if v_n = 0 then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'no_lines',
      'Quotation tanpa item bukan penawaran.', jsonb_build_object('field','lines'));
  end if;
  select string_agg(format('baris %s (%s)', line_no, description), ', ' order by line_no) into v_missing
    from ops_procure.v_quotation_line where quotation_id = q.id and cost_missing and unit_price_override is null;
  if v_missing is not null then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'cost_missing',
      format('Belum ada ongkos produksi untuk %s. Rilis BOM-nya, isi ongkos manual, atau tetapkan harga jualnya.', v_missing),
      jsonb_build_object('field','lines'));
  end if;
  if q.valid_until is not null and q.valid_until < ops_core.office_day() then
    return ops_core.invalid('project','quotation', p_quote_no,'send', 'already_expired',
      format('Berlaku sampai %s — tanggal itu sudah lewat.', q.valid_until), jsonb_build_object('field','valid_until'));
  end if;

  -- The view computes; the freeze copies what it says, so the frozen figures
  -- are exactly the ones the PM was looking at.
  update ops_procure.quotation_lines l set
    frozen_unit_cost = v.unit_cost_raw, frozen_cost_source = v.cost_source_raw, frozen_bom_rev = v.bom_rev,
    frozen_marketing_pct = v.mkt, frozen_overhead_pct = v.ovh, frozen_margin_pct = v.mrg,
    frozen_unit_price = coalesce(l.unit_price_override, ops_procure.quote_price(v.unit_cost_raw, v.mkt, v.ovh, v.mrg))
  from (
    select l2.id,
           coalesce(l2.manual_unit_cost, s.production_cost) as unit_cost_raw,
           case when l2.manual_unit_cost is not null then 'manual'
                when s.production_cost is not null then 'bom' end as cost_source_raw,
           s.rev as bom_rev,
           coalesce(l2.marketing_pct, q.marketing_pct) as mkt,
           coalesce(l2.overhead_pct,  q.overhead_pct)  as ovh,
           coalesce(l2.margin_pct,    q.margin_pct)    as mrg
      from ops_procure.quotation_lines l2
      left join ops_procure.released_cost s on s.product_code = l2.product_code
     where l2.quotation_id = q.id
  ) v
  where l.id = v.id;

  update ops_procure.quotations set status = 'SENT', sent_at = now(), sent_by = auth.uid(), updated_at = now()
   where id = q.id;

  select * into pr from ops_procure.projects where id = q.project_id;
  if pr.status = 'INQUIRY' then
    update ops_procure.projects set status = 'QUOTATION_SENT', status_changed_at = now(), updated_at = now()
     where id = pr.id;
    insert into ops_procure.project_status_log (project_id, from_status, to_status, reason, changed_by)
    values (pr.id, pr.status, 'QUOTATION_SENT', format('Quotation %s dikirim', q.quote_no), auth.uid());
  end if;
  return ops_core.ok('project','quotation', q.quote_no,'send', jsonb_build_object('quote_no', q.quote_no));
end $function$;
