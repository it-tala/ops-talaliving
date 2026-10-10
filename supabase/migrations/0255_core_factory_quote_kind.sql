-- 0255_core_factory_quote_kind.sql — a document kind for a factory's price
-- offer (O2, kajian F255 §5.3).
--
-- A factory answers a request for prices with its own paper: a PDF, a photo of
-- a price list, a WhatsApp screenshot. It is filed with the offer it backs, in
-- the PROCUREMENT drive (procurement records factory prices, Q90 / D414).
--
-- Its own migration because a value added by `alter type … add value` cannot
-- be used in the same transaction (F161). Its label, drive and folder are
-- `0256`.

alter type ops_core.doc_kind_t add value if not exists 'penawaran_pabrik';
