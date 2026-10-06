-- 0226_core_github.sql — tasks and GitHub: a merged PR hands a task over,
-- and IT's tasks appear on the organisation's GitHub Projects board (D382).
--
-- The owner, 2026-10-06: *"setup juga bagaimana ini bisa terhubung ke github
-- project supaya tim IT bisa auto-finish tugas dengan PR"*, and four answers
-- the same day:
--
--   1. A PR that names a task (`tgs-26-10-06_02` in its title or body) marks
--      the task **started** when it is opened, and **done and handed over**
--      when it is merged into the repository's default branch. The hand-over
--      note is the PR's title and link. HRD and the assigner hear about it
--      through the 0215 trigger, exactly as for a hand-over typed on screen.
--   2. A PR from somebody who is **not the task's holder** leaves the task
--      open, is recorded on it, and HRD is told (the bell) to decide.
--   3. IT tasks also appear as items on the `it-tala` GitHub Projects board.
--      Projects is free for organisations, so nothing here is paid.
--   4. One task, one person — unchanged.
--
-- ── who calls what ───────────────────────────────────────────────────────
--
-- GitHub never reaches the database. It posts a signed webhook to
-- `/api/github/webhook`, the route checks the signature with a secret only
-- it and GitHub hold, and then calls `ops_hr.github_pull_request` with the
-- service role key. The board goes the other way: `/api/github/projects/sync`
-- (run by the Worker's cron) asks `github_project_due` what changed and tells
-- `github_project_synced` what it wrote. Those three verbs are the service
-- role's and nobody else's, for the reason the chat worker's are (0143,
-- 0155): the caller is not a person, and a browser that could call them could
-- finish anybody's task by claiming to be GitHub.
--
-- Who is who on GitHub is IT's to say (`it.manage_users`, `/it/github`). A
-- login maps to one ops account and an ops account has one login. A PR from a
-- login nobody mapped is treated like rule 2 — the task stays open and HRD
-- decides — because an unknown author is exactly the case where nobody can
-- say the holder did the work.
--
-- What makes a task an "IT task" for the board: **its holder has a GitHub
-- login mapped here.** Not a unit or a bidang label — tasks carry neither,
-- and the people who work in GitHub are exactly the people IT mapped.
--
-- No semicolons inside comments in this file: the production apply tool
-- splits statements on them (F218).

/* ── part 1: tables ───────────────────────────────────────────────────── */

create table ops_core.github_accounts (
  -- Lower case. GitHub logins are case-insensitive, and the screen and the
  -- webhook must agree on one spelling.
  github_login text primary key
    check (github_login ~ '^[a-z0-9]([a-z0-9]|-[a-z0-9]){0,38}$'),
  user_id      uuid not null unique references ops_core.users(id) on delete cascade,
  linked_by    uuid references ops_core.users(id),
  linked_at    timestamptz not null default now()
);

alter table ops_core.github_accounts enable row level security;

-- IT reads the whole map, a person reads their own line. Writes go through
-- `save_github_account` only.
create policy github_accounts_read on ops_core.github_accounts
  for select to authenticated
  using ((select ops_core.has_permission('it.read')) or user_id = (select auth.uid()));

grant select on ops_core.github_accounts to authenticated;

comment on table ops_core.github_accounts is
  'GitHub login → ops account, kept by IT (D382). A PR counts as the task holder''s only '
  'when its author''s login is mapped to the holder''s account.';

-- Every webhook GitHub delivered, by its `X-GitHub-Delivery` id. GitHub
-- re-sends a delivery when it did not hear 2xx in time, and somebody can press
-- *Redeliver* by hand: the second copy is answered `noop` from here and does
-- nothing to any task.
create table ops_core.github_deliveries (
  delivery_id  text primary key check (length(btrim(delivery_id)) > 0),
  event        text not null,
  action       text,
  repo         text,
  pr_number    int,
  received_at  timestamptz not null default now(),
  -- What it did, in the words the IT screen prints.
  result       jsonb not null default '{}'::jsonb
);

create index github_deliveries_at_idx on ops_core.github_deliveries (received_at desc);

alter table ops_core.github_deliveries enable row level security;
-- No policy: read through `github_status()`.

-- A PR named on a task. One row per task per PR. The row is the record the
-- owner asked for in rule 2 — *PR-nya dicatat pada tugas* — and the link the
-- task screens print for every PR, the holder's or not.
create table ops_hr.task_pull_requests (
  id              bigserial primary key,
  task_id         uuid not null references ops_hr.tasks(id) on delete cascade,
  repo            text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  pr_number       int not null check (pr_number > 0),
  url             text not null check (url like 'https://github.com/%'),
  title           text not null,
  author_login    text not null,
  -- The ops account the login is mapped to, when it is.
  author_user_id  uuid references ops_core.users(id) on delete set null,
  -- Whether the author was the task's holder when GitHub last wrote. Only a
  -- holder's PR moves the task (rule 1). Anybody else's is recorded and HRD
  -- decides (rule 2).
  by_assignee     boolean not null,
  state           text not null check (state in ('open','merged','closed')),
  draft           boolean not null default false,
  base_ref        text,
  -- What this PR did to the task: `started`, `delivered`, or `none`.
  effect          text not null default 'none' check (effect in ('none','started','delivered')),
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  merged_at       timestamptz,
  unique (task_id, repo, pr_number)
);

create index task_pull_requests_task_idx on ops_hr.task_pull_requests (task_id);

alter table ops_hr.task_pull_requests enable row level security;

-- Whoever can read the task reads its PRs. The subquery runs under the
-- reader's own policies on `tasks` (HRD reads all, a person their own), so
-- this cannot show a PR on a task the reader cannot see.
create policy task_pull_requests_read on ops_hr.task_pull_requests
  for select to authenticated
  using (exists (select 1 from ops_hr.tasks t where t.id = task_id));

grant select on ops_hr.task_pull_requests to authenticated;

comment on table ops_hr.task_pull_requests is
  'PRs that named a task (D382). Written only by the GitHub webhook seam.';

-- The board item each IT task became, and the state last written to it.
create table ops_hr.task_github_items (
  task_id        uuid primary key references ops_hr.tasks(id) on delete cascade,
  item_id        text,
  draft_id       text,
  archived       boolean not null default false,
  -- `md5` of what the item says. A task whose fingerprint differs is due.
  fingerprint    text,
  synced_at      timestamptz,
  -- A failure keeps the fingerprint it failed on, so a task that cannot be
  -- written is tried five times and then waits until the task changes.
  failed_fingerprint text,
  attempts       int not null default 0,
  last_error     text,
  last_attempt_at timestamptz
);

alter table ops_hr.task_github_items enable row level security;
-- No policy: read through `github_status()`.

grant usage on schema ops_hr to service_role;

analyze ops_core.github_accounts;
analyze ops_core.github_deliveries;
analyze ops_hr.task_pull_requests;
analyze ops_hr.task_github_items;

/* ── part 2: IT keeps the map ─────────────────────────────────────────── */

create or replace function ops_core.list_github_accounts()
returns table (github_login text, user_id uuid, email text, full_name text,
               employee_no text, linked_at timestamptz, linked_by_name text)
language sql stable security definer set search_path = ops_core, ops_hr, pg_temp as $$
  select g.github_login, g.user_id, u.email::text, u.full_name,
         (select e.employee_no from ops_hr.employees e where e.user_id = g.user_id limit 1),
         g.linked_at, lb.full_name
    from ops_core.github_accounts g
    join ops_core.users u on u.id = g.user_id
    left join ops_core.users lb on lb.id = g.linked_by
   where ops_core.has_permission('it.read')
   order by u.full_name;
$$;

-- `p_login` null removes the account's mapping. A login is written lower
-- case. Moving a login to another account, or giving an account a second
-- login, is refused with the name of who holds it — that is a decision to
-- make on purpose (remove first), not a side effect of a typo.
create or replace function ops_core.save_github_account(p_user_id uuid, p_login text)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare
  v_login text := lower(btrim(coalesce(p_login, '')));
  v_user  ops_core.users%rowtype;
  v_old   ops_core.github_accounts%rowtype;
  v_other ops_core.github_accounts%rowtype;
begin
  if not ops_core.has_permission('it.manage_users') then
    return ops_core.refused('identity','github_account', v_login, 'save', 'not_permitted',
      'Memetakan akun GitHub adalah tugas IT (kelola pengguna).');
  end if;

  select * into v_user from ops_core.users where id = p_user_id;
  if not found then
    return ops_core.not_found('identity','github_account', p_user_id::text, 'save',
      'Akun ops itu tidak ada.');
  end if;
  select * into v_old from ops_core.github_accounts where user_id = p_user_id;

  if v_login = '' then
    if v_old.github_login is null then
      return ops_core.noop('identity','github_account', v_user.email::text, 'remove',
        format('%s memang belum punya akun GitHub.', v_user.full_name));
    end if;
    delete from ops_core.github_accounts where user_id = p_user_id;
    return ops_core.ok('identity','github_account', v_old.github_login, 'remove',
      jsonb_build_object('user_id', p_user_id, 'github_login', null),
      to_jsonb(v_old), null);
  end if;

  v_login := regexp_replace(v_login, '^@', '');
  if v_login !~ '^[a-z0-9]([a-z0-9]|-[a-z0-9]){0,38}$' then
    return ops_core.invalid('identity','github_account', v_login, 'save', 'bad_login',
      'Login GitHub hanya huruf, angka, dan tanda hubung tunggal (maks. 39), tanpa @ dan tanpa alamat lengkap.',
      jsonb_build_object('field','github_login'));
  end if;
  if not v_user.is_active then
    return ops_core.conflict('identity','github_account', v_login, 'save', 'user_inactive',
      format('%s sudah tidak aktif.', v_user.full_name));
  end if;

  select * into v_other from ops_core.github_accounts where github_login = v_login;
  if found and v_other.user_id <> p_user_id then
    return ops_core.conflict('identity','github_account', v_login, 'save', 'login_taken',
      format('%s sudah dipetakan ke %s. Lepas dulu dari akun itu.', v_login,
             (select full_name from ops_core.users where id = v_other.user_id)));
  end if;
  if v_old.github_login = v_login then
    return ops_core.noop('identity','github_account', v_login, 'save',
      format('%s sudah dipetakan ke %s.', v_login, v_user.full_name));
  end if;

  if v_old.github_login is not null then
    update ops_core.github_accounts
       set github_login = v_login, linked_by = auth.uid(), linked_at = now()
     where user_id = p_user_id;
  else
    insert into ops_core.github_accounts (github_login, user_id, linked_by)
    values (v_login, p_user_id, auth.uid());
  end if;

  return ops_core.ok('identity','github_account', v_login, 'save',
    jsonb_build_object('user_id', p_user_id, 'github_login', v_login),
    case when v_old.github_login is null then null else to_jsonb(v_old) end,
    jsonb_build_object('github_login', v_login, 'user', v_user.email));
end $$;

/* ── what IT sees: is GitHub talking to us, and is the board up to date ── */
create or replace function ops_core.github_status()
returns jsonb
language plpgsql stable security definer set search_path = ops_core, ops_hr, pg_temp as $$
begin
  if not ops_core.has_permission('it.read') then
    return null;
  end if;
  return jsonb_build_object(
    'accounts', (select count(*) from ops_core.github_accounts),
    'last_delivery_at', (select max(received_at) from ops_core.github_deliveries),
    'deliveries', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.received_at desc)
        from (select delivery_id, event, action, repo, pr_number, received_at, result
                from ops_core.github_deliveries
               order by received_at desc limit 20) d), '[]'::jsonb),
    'linked_prs', (select count(*) from ops_hr.task_pull_requests),
    'items_synced', (select count(*) from ops_hr.task_github_items where item_id is not null),
    'last_synced_at', (select max(synced_at) from ops_hr.task_github_items),
    'sync_errors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_no', t.task_no, 'title', t.title, 'error', i.last_error,
               'attempts', i.attempts, 'at', i.last_attempt_at) order by i.last_attempt_at desc)
        from ops_hr.task_github_items i
        join ops_hr.tasks t on t.id = i.task_id
       where i.last_error is not null), '[]'::jsonb));
end $$;

/* ── the PRs on the tasks a reader can see ───────────────────────────────
 *
 *  Invoker: the reader's own policies on `tasks` and `task_pull_requests`
 *  decide what comes back. `p_task_nos` null = every PR the reader may see.
 */
create or replace function ops_hr.list_task_pull_requests(p_task_nos text[] default null)
returns table (task_no text, repo text, pr_number int, url text, title text,
               author_login text, by_assignee boolean, state text, draft boolean,
               base_ref text, effect text, first_seen_at timestamptz,
               updated_at timestamptz, merged_at timestamptz)
language sql stable security invoker set search_path = ops_hr, pg_temp as $$
  select t.task_no, p.repo, p.pr_number, p.url, p.title, p.author_login, p.by_assignee,
         p.state, p.draft, p.base_ref, p.effect, p.first_seen_at, p.updated_at, p.merged_at
    from ops_hr.task_pull_requests p
    join ops_hr.tasks t on t.id = p.task_id
   where p_task_nos is null or t.task_no = any(p_task_nos)
   order by p.first_seen_at desc, p.id desc;
$$;

/* ── part 3: the webhook ──────────────────────────────────────────────────
 *
 *  One call per `pull_request` delivery. The route has already checked the
 *  signature and passes the fields as GitHub sent them. Every task number
 *  named in the title or the body is handled on its own.
 *
 *  Out-of-order deliveries are expected (GitHub does not promise order, and a
 *  redelivery can arrive a day late), so nothing here moves backwards: a
 *  merged PR stays merged, a done task is never started, and `opened`
 *  arriving after `closed` only refreshes the title.
 */
create or replace function ops_hr.github_pull_request(
  p_delivery text, p_action text, p_repo text, p_number int, p_url text,
  p_title text, p_body text, p_author text, p_draft boolean, p_merged boolean,
  p_base text, p_default_branch text)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_entity  text := coalesce(p_repo, '?') || '#' || coalesce(p_number::text, '?');
  v_login   text := lower(btrim(coalesce(p_author, '')));
  v_author  uuid;
  v_author_name text;
  v_state   text;
  v_nos     text[];
  v_no      text;
  t         ops_hr.tasks%rowtype;
  v_holder  uuid;
  v_mine    boolean;
  v_prev    ops_hr.task_pull_requests%rowtype;
  v_effect  text;
  v_did     text;
  v_note    text;
  v_results jsonb := '[]'::jsonb;
  v_unknown text[] := '{}';
  v_data    jsonb;
  r         record;
begin
  if coalesce(btrim(p_delivery), '') = '' then
    return ops_core.invalid('hr','github_pr', v_entity, coalesce(p_action,'?'), 'delivery_required',
      'Tanpa X-GitHub-Delivery tidak ada cara mengenali kiriman ulang.');
  end if;

  insert into ops_core.github_deliveries (delivery_id, event, action, repo, pr_number)
  values (p_delivery, 'pull_request', p_action, p_repo, p_number)
  on conflict (delivery_id) do nothing;
  if not found then
    return ops_core.noop('hr','github_pr', v_entity, coalesce(p_action,'?'),
      format('Kiriman %s sudah diproses — kiriman ulang tidak mengubah apa pun.', p_delivery),
      jsonb_build_object('replay', true));
  end if;

  if p_action is null
     or p_action not in ('opened','reopened','edited','ready_for_review','converted_to_draft',
                         'synchronize','closed') then
    update ops_core.github_deliveries set result = jsonb_build_object('ignored', p_action)
     where delivery_id = p_delivery;
    return ops_core.noop('hr','github_pr', v_entity, coalesce(p_action,'?'),
      format('Aksi PR %s tidak mengubah tugas.', coalesce(p_action, '(kosong)')));
  end if;
  if p_repo is null or p_number is null or p_url is null or v_login = '' then
    return ops_core.invalid('hr','github_pr', v_entity, p_action, 'incomplete',
      'Kiriman PR tidak lengkap (repo, nomor, url, atau penulis kosong).');
  end if;

  -- Task numbers, lower case, each once, at most ten — a PR that names more
  -- than ten tasks is a list, not a piece of work.
  select array_agg(distinct m[1]) into v_nos
    from regexp_matches(lower(coalesce(p_title, '') || E'\n' || coalesce(p_body, '')),
                        '(tgs-[0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]+)', 'g') as m;
  if v_nos is null then
    update ops_core.github_deliveries set result = jsonb_build_object('tasks', '[]'::jsonb)
     where delivery_id = p_delivery;
    return ops_core.noop('hr','github_pr', v_entity, p_action,
      'PR ini tidak menyebut nomor tugas (tgs-…).');
  end if;
  v_nos := v_nos[1:10];

  select g.user_id, u.full_name into v_author, v_author_name
    from ops_core.github_accounts g join ops_core.users u on u.id = g.user_id
   where g.github_login = v_login;

  v_state := case when p_action = 'closed' and coalesce(p_merged, false) then 'merged'
                  when p_action = 'closed' then 'closed'
                  else 'open' end;

  foreach v_no in array v_nos loop
    select * into t from ops_hr.tasks where task_no = v_no for update;
    if not found then
      v_unknown := v_unknown || v_no;
      continue;
    end if;

    v_holder := null;
    v_prev := null;
    select e.user_id into v_holder from ops_hr.employees e where e.id = t.assignee_id;
    v_mine := v_author is not null and v_author is not distinct from v_holder;

    select * into v_prev from ops_hr.task_pull_requests
     where task_id = t.id and repo = p_repo and pr_number = p_number;

    v_effect := coalesce(v_prev.effect, 'none');
    v_did := 'recorded';

    if v_mine then
      if v_state = 'open' and t.status = 'OPEN' and t.started_at is null then
        update ops_hr.tasks set started_at = now() where id = t.id;
        v_effect := 'started';
        v_did := 'started';
      elsif v_state = 'merged' and t.status = 'OPEN'
            and p_base is not null and p_base = p_default_branch then
        -- The hand-over note is the PR, title and link (rule 1). D368 asks a
        -- holder closing their own task to say what was handed over and where,
        -- and a merged PR is both.
        v_note := left(format('PR %s#%s %s — %s', p_repo, p_number,
                              btrim(coalesce(p_title, '')), p_url), 2000);
        update ops_hr.tasks
           set status = 'DONE', done_at = now(), done_by = v_author,
               started_at = coalesce(started_at, now()),
               delivered_note = v_note,
               blocked_reason = null, blocked_at = null
         where id = t.id;
        v_effect := 'delivered';
        v_did := 'delivered';
      elsif v_state = 'merged' and t.status = 'OPEN' then
        v_did := 'merged_not_default';
      elsif v_state = 'merged' then
        v_did := 'task_already_' || lower(t.status::text);
      end if;
    else
      v_did := case when v_author is null then 'held_unmapped' else 'held_not_holder' end;
    end if;

    insert into ops_hr.task_pull_requests
      (task_id, repo, pr_number, url, title, author_login, author_user_id, by_assignee,
       state, draft, base_ref, effect, merged_at)
    values (t.id, p_repo, p_number, p_url, coalesce(nullif(btrim(p_title), ''), p_url), v_login,
            v_author, v_mine, v_state, coalesce(p_draft, false), p_base, v_effect,
            case when v_state = 'merged' then now() end)
    on conflict (task_id, repo, pr_number) do update
       set url = excluded.url, title = excluded.title,
           author_login = excluded.author_login, author_user_id = excluded.author_user_id,
           by_assignee = excluded.by_assignee,
           -- Merged is final: a late `opened` or `closed` does not undo it.
           state = case when task_pull_requests.state = 'merged' then 'merged' else excluded.state end,
           draft = excluded.draft, base_ref = excluded.base_ref,
           effect = excluded.effect,
           merged_at = coalesce(task_pull_requests.merged_at, excluded.merged_at),
           updated_at = now();

    -- Rule 2: HRD decides. Told once when the PR first names the task, and
    -- once more when it is merged — the two moments a decision is asked for.
    if not v_mine and t.status = 'OPEN'
       and (v_prev.id is null or (v_state = 'merged' and v_prev.state <> 'merged')) then
      v_data := jsonb_build_object(
        'task_no', t.task_no, 'title', t.title,
        'assignee', (select full_name from ops_hr.employees where id = t.assignee_id),
        'repo', p_repo, 'number', p_number, 'url', p_url, 'pr_title', p_title,
        'author_login', v_login, 'author_name', v_author_name,
        'reason', case when v_author is null then 'unmapped' else 'not_holder' end,
        'merged', v_state = 'merged');
      for r in
        select u.id from ops_core.users u
         where u.is_active
           and exists (select 1 from ops_core.user_modules m
                        where m.user_id = u.id and m.module = 'hrd' and m.level in ('write','admin'))
      loop
        insert into ops_core.notifications (user_id, kind, title, data, link, entity_no)
        values (r.id, 'task.github_pr',
                format('%s %s menyebut tugas %s (%s), tapi bukan dari pemegang tugasnya — tugas tetap terbuka',
                       case when v_state = 'merged' then 'PR yang di-merge' else 'PR' end,
                       p_repo || '#' || p_number, t.task_no, t.title),
                v_data, '/hrd/tugas?tab=all', t.task_no);
      end loop;
    end if;

    v_results := v_results || jsonb_build_object('task_no', t.task_no, 'did', v_did);
  end loop;

  update ops_core.github_deliveries
     set result = jsonb_build_object('tasks', v_results, 'unknown', to_jsonb(v_unknown),
                                     'author', v_login, 'mapped', v_author is not null)
   where delivery_id = p_delivery;

  return ops_core.ok('hr','github_pr', v_entity, p_action,
    jsonb_build_object('tasks', v_results, 'unknown', to_jsonb(v_unknown)),
    null,
    jsonb_build_object('delivery', p_delivery, 'author', v_login, 'state', v_state,
                       'url', p_url));
end $$;

/* ── part 4: the board ────────────────────────────────────────────────────
 *
 *  State, not events: the sync asks *which IT tasks differ from what the
 *  board says*, writes them, and records what it wrote. A missed run, a
 *  token that was down for a day, or a board item somebody deleted all heal
 *  on the next run without anybody replaying anything.
 *
 *  Due: a task whose holder has a GitHub login, open or done in the last
 *  seven days, that has no item yet — and any task that has an item whose
 *  fingerprint changed (including a task moved to somebody without a login,
 *  so the item stops naming the old holder).
 */
create or replace function ops_hr.github_project_due(p_limit int default 20)
returns table (task_no text, title text, detail text, deliverable text, due_date date,
               status text, started boolean, blocked_reason text, assignee_name text,
               github_login text, goal_title text, goal_rank int,
               item_id text, draft_id text, archived boolean, fingerprint text)
language sql stable security definer set search_path = ops_hr, ops_core, pg_temp as $$
  with c as (
    select t.task_no, t.title, t.detail, t.deliverable, t.due_date, t.status::text as status,
           t.started_at is not null as started, t.blocked_reason,
           e.full_name as assignee_name, g.github_login,
           go.title as goal_title, go.rank as goal_rank,
           i.item_id, i.draft_id, coalesce(i.archived, false) as archived,
           i.fingerprint as synced, i.failed_fingerprint, coalesce(i.attempts, 0) as attempts,
           t.assigned_at
      from ops_hr.tasks t
      join ops_hr.employees e on e.id = t.assignee_id
      left join ops_core.github_accounts g on g.user_id = e.user_id
      left join ops_hr.goals go on go.id = t.goal_id
      left join ops_hr.task_github_items i on i.task_id = t.id
     where i.item_id is not null
        or (g.github_login is not null
            and (t.status = 'OPEN'
                 or (t.status = 'DONE' and t.done_at > now() - interval '7 days')))
  ), f as (
    select c.*, md5(concat_ws('|', c.title, c.detail, c.deliverable, c.due_date, c.status,
                               c.started, c.blocked_reason, c.assignee_name, c.github_login,
                               c.goal_title, c.goal_rank)) as fp
      from c
  )
  select f.task_no, f.title, f.detail, f.deliverable, f.due_date, f.status, f.started,
         f.blocked_reason, f.assignee_name, f.github_login, f.goal_title, f.goal_rank,
         f.item_id, f.draft_id, f.archived, f.fp
    from f
   where f.synced is distinct from f.fp
     and not (f.failed_fingerprint = f.fp and f.attempts >= 5)
   order by f.assigned_at
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- What the sync wrote. `p_error` null = the item now says `p_fingerprint`.
-- A failure is kept, with how many times, and the IT screen prints it.
create or replace function ops_hr.github_project_synced(
  p_task_no text, p_item_id text, p_draft_id text, p_archived boolean,
  p_fingerprint text, p_error text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare v_task uuid;
begin
  select id into v_task from ops_hr.tasks where task_no = p_task_no;
  if v_task is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_error is null then
    insert into ops_hr.task_github_items as i
      (task_id, item_id, draft_id, archived, fingerprint, synced_at, attempts, last_attempt_at)
    values (v_task, p_item_id, p_draft_id, coalesce(p_archived, false), p_fingerprint, now(), 0, now())
    on conflict (task_id) do update
       set item_id = excluded.item_id, draft_id = excluded.draft_id,
           archived = excluded.archived, fingerprint = excluded.fingerprint,
           synced_at = now(), failed_fingerprint = null, attempts = 0,
           last_error = null, last_attempt_at = now();
  else
    insert into ops_hr.task_github_items as i
      (task_id, item_id, draft_id, archived, failed_fingerprint, attempts, last_error, last_attempt_at)
    values (v_task, p_item_id, p_draft_id, coalesce(p_archived, false), p_fingerprint, 1,
            left(p_error, 1000), now())
    on conflict (task_id) do update
       set item_id = coalesce(excluded.item_id, i.item_id),
           draft_id = coalesce(excluded.draft_id, i.draft_id),
           attempts = case when i.failed_fingerprint is not distinct from excluded.failed_fingerprint
                           then i.attempts + 1 else 1 end,
           failed_fingerprint = excluded.failed_fingerprint,
           last_error = excluded.last_error, last_attempt_at = now();
  end if;
  return jsonb_build_object('outcome', 'ok');
end $$;

/* ── part 5: grants, one at a time (F147) ─────────────────────────────── */
revoke execute on function ops_core.list_github_accounts() from public;
revoke execute on function ops_core.save_github_account(uuid, text) from public;
revoke execute on function ops_core.github_status() from public;
revoke execute on function ops_hr.list_task_pull_requests(text[]) from public;
revoke execute on function ops_hr.github_pull_request(text, text, text, int, text, text, text, text, boolean, boolean, text, text) from public;
revoke execute on function ops_hr.github_project_due(int) from public;
revoke execute on function ops_hr.github_project_synced(text, text, text, boolean, text, text) from public;

grant execute on function ops_core.list_github_accounts() to authenticated;
grant execute on function ops_core.save_github_account(uuid, text) to authenticated;
grant execute on function ops_core.github_status() to authenticated;
grant execute on function ops_hr.list_task_pull_requests(text[]) to authenticated;

-- The webhook's and the board sync's, and nobody else's. Not seams a person
-- calls: a person never "is GitHub". See A2 §4.
grant execute on function ops_hr.github_pull_request(text, text, text, int, text, text, text, text, boolean, boolean, text, text) to service_role;
grant execute on function ops_hr.github_project_due(int) to service_role;
grant execute on function ops_hr.github_project_synced(text, text, text, boolean, text, text) to service_role;
