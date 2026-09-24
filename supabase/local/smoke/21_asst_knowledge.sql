-- asst — the process knowledge John Lau's model reads (0136, 0137).
--
-- Three things have to stay true, and each one is a way the model could be
-- told something wrong without anybody seeing it happen:
--   * anybody signed in can read it — a guide is not a privilege (0136);
--   * nobody can write it through the API — the rows arrive by migration, so
--     a wrong instruction is a reviewable diff, never an edit from a browser;
--   * the flow is walkable: every process has steps, numbered from one with
--     no gaps, and `follows` never loops back on itself.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('21210000-0000-0000-0000-000000000001','siapa@talaliving.com','{"full_name":"Siapa Saja"}');

set local role authenticated;
set local request.jwt.claim.sub = '21210000-0000-0000-0000-000000000001';

do $$
declare n int;
begin
  -- No module grant at all, and the knowledge still reads.
  select count(*) into n from ops_asst.processes;
  assert n >= 9, format('the procurement walk is readable by anybody signed in, saw %s', n);
  select count(*) into n from ops_asst.process_steps;
  assert n > 0, 'and its steps';
  select count(*) into n from ops_asst.process_faq;
  assert n > 0, 'and its questions';
end $$;

do $$
begin
  begin
    insert into ops_asst.processes (key, module, seq, title, purpose, route)
    values ('procure.fake','procurement',1,'x','x','/x');
    assert false, 'a browser must not be able to write the knowledge';
  exception when insufficient_privilege then null;
  end;
  begin
    update ops_asst.process_steps set action = 'Tekan tombol apa saja.';
    assert false, 'nor rewrite a step';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role postgres;

do $$
declare bad text;
begin
  select string_agg(p.key, ', ') into bad from ops_asst.processes p
   where not exists (select 1 from ops_asst.process_steps s where s.process_key = p.key);
  assert bad is null, format('a process with no steps is a title, not a guide: %s', bad);

  select string_agg(process_key, ', ') into bad from (
    select process_key, max(seq) m, count(*) c from ops_asst.process_steps group by 1) x
   where m <> c;
  assert bad is null, format('steps are numbered from one with no gaps: %s', bad);

  -- `follows` is how *terus apa?* is answered; a loop answers it forever.
  with recursive walk(start, cur, depth) as (
    select key, follows, 1 from ops_asst.processes where follows is not null
    union all
    select w.start, p.follows, w.depth + 1 from walk w
      join ops_asst.processes p on p.key = w.cur
     where p.follows is not null and w.depth < 50)
  select string_agg(distinct start, ', ') into bad from walk where cur = start or depth >= 50;
  assert bad is null, format('follows loops back on itself: %s', bad);
end $$;

rollback;
