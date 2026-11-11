-- acct — resolve_inbox argument order (0287). Production carried the 0039
-- draft with p_pr_line_no fourth, so a positional NOTED put its words into
-- the request-line slot and was refused `no_such_line`. The order is part of
-- the contract: (ref_id, status, trx_no, note, key, pr_line_no).

begin;

/* ── the signature itself: one function, pr_line_no last ──────────────── */
do $$
declare n int; names text[];
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'ops_acct' and p.proname = 'resolve_inbox';
  assert n = 1, format('exactly one resolve_inbox, got %s', n);
  select p.proargnames into names from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'ops_acct' and p.proname = 'resolve_inbox';
  assert names = array['p_ref_id','p_status','p_trx_no','p_note','p_key','p_pr_line_no'],
    format('argument order drifted: %s', names);
  assert has_function_privilege('authenticated',
    'ops_acct.resolve_inbox(text, ops_acct.inbox_status_t, text, text, text, text)', 'execute'),
    'authenticated may call it';
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-00000000f287','akun287@talaliving.com','{"full_name":"Akun 287"}');
insert into ops_core.user_authorities (user_id, authority) values
  ('ffffffff-0000-0000-0000-00000000f287','resolve_inbox');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-00000000f287','accounting','write');
insert into ops_core.attachments (id, storage_path, filename, source, uploaded_by) values
  ('44440000-0000-0000-0000-000000000387','drive-287-s','saldo-bca.png','chat','ffffffff-0000-0000-0000-00000000f287');
insert into ops_acct.evidence_inbox (ref_id, origin, status, attachment_id, reported_by, extracted) values
  ('ev287s~x0','chat','PENDING','44440000-0000-0000-0000-000000000387','ffffffff-0000-0000-0000-00000000f287',
   '{"doc_type":"Others"}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-00000000f287';

/* ── the call that failed in production on 11 Nov, positional ─────────── */
do $$
declare r jsonb; v ops_acct.evidence_inbox;
begin
  r := ops_acct.resolve_inbox('ev287s~x0', 'NOTED', null,
         'Screenshot saldo rekening (bukan transaksi).', 'e14-note');
  assert r ->> 'outcome' = 'ok', format('positional NOTED must succeed, got %s', r);
  select * into v from ops_acct.evidence_inbox where ref_id = 'ev287s~x0';
  assert v.status = 'NOTED', format('status %s', v.status);
  assert v.resolve_note = 'Screenshot saldo rekening (bukan transaksi).', 'the words went to the note';
  assert v.produced_pr_line_no is null, 'and not to the request line';
end $$;

rollback;
