-- 0023_core_audit_view.sql — the trail, as a screen reads it.
--
-- `ops_core.audit_log` stores `actor_id`, because a uuid is what a foreign key
-- can hold and a person's address is not stable. `/it/audit` asks a different
-- question — *who did this* — and answering it by having the screen fetch the
-- user list and join in TypeScript would put a second definition of "who" in
-- the client, one row at a time, over the network.
--
-- So the join lives here. B2: a derivation is a view (A3).
--
-- `security_invoker = on` matters more than usual on this one. The policy
-- `audit_read` on the base table already restricts the trail to `it.read`
-- (`0003_core_audit.sql:93`); with the invoker's rights the view inherits that
-- refusal unchanged. Left off, this view would hand the whole audit trail to
-- anybody who could select from it — the trail being precisely the thing that
-- records who was allowed to see what.

create or replace view ops_core.v_audit as
  select a.id::text                     as id,
         a.at,
         -- A null `actor_id` is not missing data: `write_audit` inserts
         -- `auth.uid()`, which is null when nothing authenticated made the
         -- change — a scheduled job, an import, the database itself. Naming
         -- that `system` says so; an empty string would read as a row whose
         -- author was lost.
         coalesce(u.email, 'system')    as actor_email,
         a.service,
         a.entity,
         -- The contract has this non-null: a trail row always names something,
         -- even when the thing it names has no public code yet.
         coalesce(a.entity_no, '')      as entity_no,
         a.action,
         a.outcome,
         a.reason,
         a.detail
    from ops_core.audit_log a
    left join ops_core.users u on u.id = a.actor_id;

alter view ops_core.v_audit set (security_invoker = on);

grant select on ops_core.v_audit to authenticated;
