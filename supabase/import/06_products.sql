-- 06_products.sql — the 27 item codes of the legacy catalogue, with their
-- gambar kerja.
--
-- Source: `public.products` (item_code, name, dimension, drawing_link,
-- spec_link …). Target: `ops_prod.products`, one row per item code, and each
-- `drawing_link` filed as a **Gambar Kerja** link on the product — the drawing
-- the BOM screen shows beside the component list (0109).
--
-- Needs `0060`–`0066` and `0108`–`0109` applied first. Run it like the others
-- (see README.md); it is idempotent through `ops_core.legacy_map`, so a second
-- run imports nothing and changes nothing it imported the first time.
--
-- ── What maps, and what does not ────────────────────────────────────────
--
--   item_code      → product_code, exactly as written (`OV-505 B / BV 505 B`
--                    included — it is on the drawing, and the code is
--                    permanent once imported, so it is not "tidied" here)
--   name           → name
--   dimension      → length/width/height when it reads `A × B × C mm`;
--                    anything else (`W 550 × H 25 mm`) stays whole in
--                    `dimension_note` rather than being guessed into axes
--   description, material, finish, notes → description / note, when present
--   drawing_link   → a Gambar Kerja attachment link, filed as the shared
--                    account (nobody in the legacy row is named as its author)
--   spec_link      → kept in `note` as a link. There is no *spesifikasi*
--                    document kind, and inventing one is not an import's call.
--   category       → `Belum dikategorikan`. The legacy table has none, and a
--                    category guessed from a code prefix is a category nobody
--                    chose.
--   uom            → `unit`
--
-- No BOM is imported: the legacy system never had one. That is the work the
-- screen exists for.

begin;

create temp table _run on commit drop as select gen_random_uuid() as run_id;

create temp table _actor on commit drop as
  select id from ops_core.users where email = 'shared@talaliving.com';

do $$
begin
  if not exists (select 1 from _actor) then
    raise exception 'shared@talaliving.com has no profile — the drawings need an author to be filed as';
  end if;
  if to_regclass('ops_prod.products') is null then
    raise exception 'ops_prod.products does not exist — apply 0060 onwards first';
  end if;
end $$;

create temp table _staged on commit drop as
select
  btrim(p.item_code)                                   as code,
  btrim(p.name)                                        as name,
  nullif(btrim(p.description), '')                     as description,
  p.dimension,
  m.dims,
  nullif(btrim(p.drawing_link), '')                    as drawing_link,
  nullif(concat_ws(' · ',
    nullif(btrim(p.material), '') ,
    nullif(btrim(p.finish), ''),
    nullif(btrim(p.notes), ''),
    case when nullif(btrim(p.spec_link), '') is not null then 'Spesifikasi: ' || btrim(p.spec_link) end
  ), '')                                               as note,
  coalesce(p.active, true)                             as active
from public.products p
left join lateral (
  select regexp_match(btrim(p.dimension), '^([0-9]+)\s*[×x]\s*([0-9]+)\s*[×x]\s*([0-9]+)\s*mm$') as dims
) m on true
where coalesce(btrim(p.item_code), '') <> ''
  and not exists (select 1 from ops_core.legacy_map l
                   where l.source_table = 'public.products' and l.source_id = btrim(p.item_code));

insert into ops_prod.products
  (product_code, name, category, uom, description,
   length_mm, width_mm, height_mm, dimension_note, active, note, created_by)
select s.code, s.name, 'Belum dikategorikan', 'unit', s.description,
       (s.dims[1])::int, (s.dims[2])::int, (s.dims[3])::int,
       case when s.dims is null then nullif(btrim(s.dimension), '') end,
       s.active, s.note, (select id from _actor)
  from _staged s
 where not exists (select 1 from ops_prod.products x where x.product_code = s.code);

-- The drawing: a link attachment, then its link to the product.
create temp table _drawings on commit drop as
select s.code, s.drawing_link, gen_random_uuid() as attachment_id
  from _staged s where s.drawing_link is not null;

insert into ops_core.attachments (id, url, filename, mime, source, uploaded_by)
select d.attachment_id, d.drawing_link, 'Gambar kerja ' || d.code, 'text/uri-list', 'import',
       (select id from _actor)
  from _drawings d;

insert into ops_core.attachment_links (attachment_id, entity, entity_no, kind, note, linked_by)
select d.attachment_id, 'product', d.code, 'gambar_kerja', 'dari katalog lama (public.products)',
       (select id from _actor)
  from _drawings d;

insert into ops_core.legacy_map (source_table, source_id, target_table, target_id, outcome, note, run_id)
select 'public.products', s.code, 'ops_prod.products', p.id,
       case when p.created_by = (select id from _actor) and p.id is not null then 'imported' else 'skipped' end,
       nullif(concat_ws('; ',
         case when s.dims is null and s.dimension is not null
              then 'dimension ' || quote_literal(s.dimension) || ' not three axes — kept whole in dimension_note' end,
         case when s.drawing_link is null then 'no drawing_link in the legacy row' end
       ), ''),
       (select run_id from _run)
  from _staged s
  left join ops_prod.products p on p.product_code = s.code
 on conflict (source_table, source_id) do nothing;

\echo ''
\echo '── what came across ────────────────────────────────────────────────'
select count(*)                                                  as products,
       count(*) filter (where length_mm is not null)             as with_axes,
       count(*) filter (where dimension_note is not null)        as size_as_note,
       (select count(*) from ops_core.attachment_links
         where entity = 'product' and kind = 'gambar_kerja' and unlinked_at is null) as gambar_kerja_links
  from ops_prod.products;

commit;
