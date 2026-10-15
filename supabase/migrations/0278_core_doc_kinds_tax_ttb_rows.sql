-- 0278 — the label, the drive and the folder for the two kinds 0277 added
-- (L8). The smoke in 92 refuses a kind with no label or no drive, which is
-- the point: a kind the UI cannot name renders as a blank chip.
insert into ops_core.doc_kind_labels (kind, label) values
  ('faktur_pajak', 'Faktur Pajak'),
  ('ttb',          'TTB')
on conflict (kind) do nothing;

insert into ops_core.doc_kind_drive (kind, slug, rationale) values
  -- A tax invoice is a money paper: it goes beside the nota it belongs to.
  ('faktur_pajak', 'accounting',  'The tax invoice beside the nota — read with the money (D433 Q92).'),
  -- A signed handover receipt is a receiving paper, like the vendor's own
  -- delivery note.
  ('ttb',          'procurement', 'Tanda terima barang: the courier''s signed receipt for what was handed over.')
on conflict (kind) do nothing;

insert into ops_core.drive_paths (kind, entity, path, note) values
  ('ttb', null, 'RECEIVING REPORT', 'Signed on arrival, filed with the receiving papers.')
on conflict (kind, entity) do nothing;
