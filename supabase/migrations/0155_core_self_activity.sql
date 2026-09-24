-- 0155_core_self_activity.sql — the profile screen's own activity feed.
--
-- ── the tension this sits on top of ───────────────────────────────────────
--
-- W7 in the backlog asks for a profile screen that includes *cek aktifitas
-- terakhir yang dikerjakan (mirip activity log/audit log IT tapi versi dia
-- saja)*. `0027` already built the IT-grade version of that sentence and
-- D190 refused, in words, to let a person read their own row in it: *a person
-- who can see exactly what was logged about them is a person who knows
-- precisely what is not* — the granular `view`/`export`/`print` telemetry
-- exists to catch what somebody would otherwise get away with, and showing it
-- back teaches exactly that.
--
-- That refusal is still right, and it is not what this migration reopens.
-- `activity_events` stays the one store (D7): no second table, no forked
-- write path. What changes is that a small, named set of **kinds** — the
-- self-service actions this build adds, plus the two already documented in
-- `0027`'s own comment and never wired — become visible to the person they
-- are about, and nothing else does. `view`, `export` and `print` are not on
-- the list and a self-reader still cannot see them, so the surveillance-grade
-- detail D190 was written to protect stays exactly as closed as it was.
--
-- Two permissive RLS policies compose with OR, so `it.read` keeps seeing
-- everything this file changes nothing about.

create policy activity_events_read_own on ops_core.activity_events
  for select to authenticated
  using (
    actor_id = auth.uid()
    and kind = any (array[
      'sign_in', 'sign_out',            -- documented in 0027, not yet wired
      'update',                          -- identity.setPassword's own kind
      'attendance_tap',
      'leave_requested',
      'overtime_requested',
      'task_acknowledged'
    ]::text[])
  );

-- What the profile screen reads. Not a join to `ops_core.users` — every row
-- is already the caller's own, so printing their name back at them is not
-- needed the way it is on `v_activity_event`.
create or replace view ops_core.v_my_activity as
  select id, at, kind, target, label
    from ops_core.activity_events
   order by at desc;

alter view ops_core.v_my_activity set (security_invoker = on);
grant select on ops_core.v_my_activity to authenticated;
