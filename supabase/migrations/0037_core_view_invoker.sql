-- 0037_core_view_invoker.sql — the view that was reading with the wrong
-- rights, and the comment that caused it.
--
-- ── The claim, and why it is backwards ───────────────────────────────────
--
-- `0014_procure_views.sql` says, above a list of twenty `alter view … set
-- (security_invoker = on)`:
--
--   *Views run with the caller's rights by default in Postgres 15+, which is
--    what we want everywhere here … Stated rather than assumed, because the
--    default changed and somebody reading this on an older server should not
--    have to guess.*
--
-- **That is the wrong way round.** Postgres 15 *added* `security_invoker`; it
-- did not change the default. A view still runs with its **owner's** rights
-- unless told otherwise, which on this project means `postgres` — a role with
-- `bypassrls`. Measured rather than argued:
--
--     create view v_leak_probe as select code, name from ops_procure.vendors;
--
--     direct table read, as somebody with no procurement grant  → 0 rows
--     the same rows through that view                           → 1 row
--
-- So the twenty `alter view` lines were not documentation of a default. They
-- were the only thing making those views safe, and three views in the ladder
-- never got one.
--
-- ── Two of the three are deliberate ──────────────────────────────────────
--
-- `ops_core.v_my_access` and `ops_core.v_user_access` read past RLS on
-- purpose — they are how somebody is told what they may open, which cannot
-- itself be gated on what they may open. `v_user_access` says so in its own
-- `security_invoker = off`.
--
-- ── The third is `v_po_detail`, and it was safe by accident ──────────────
--
-- It inner-joins `v_po_status` and `v_po_journey`, both of which *are*
-- invoker views. A reader with no procurement grant gets nothing from those,
-- and the join drops the row — so nothing leaked, and nothing about
-- `v_po_detail` was making that true. Remove one of those joins, or make
-- either of them a left join, and it starts answering every purchase order in
-- the company to anybody signed in.
--
-- `/procurement/po/[po]` and `/procurement/po/[po]/print` read it, and both are
-- live.
--
-- Nothing is lost by fixing it: the only tables it reaches that the inner views
-- do not are `ops_core.users`, whose read policy is `true`, and
-- `ops_core.attachments`. Names still resolve; a reader who may not see an
-- attachment now stops seeing its filename, which is the correct answer and
-- was already the answer everywhere else.

alter view ops_procure.v_po_detail set (security_invoker = on);

comment on view ops_procure.v_po_detail is
  'One order, whole, for the drawer. security_invoker = on — it was the only view in '
  'ops_procure without it, and was safe only because its inner joins to v_po_status and '
  'v_po_journey are invoker views and drop the row for a reader with no grant. (0037)';
