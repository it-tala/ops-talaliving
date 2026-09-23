-- 0115_inv_asset_returned.sql — a rented, leased or borrowed asset ends by
-- going back to its owner, which is neither disposed nor lost (`0116`).
-- On its own because a new enum value cannot be used in the transaction that
-- adds it.
alter type ops_inv.asset_status_t add value if not exists 'returned';
