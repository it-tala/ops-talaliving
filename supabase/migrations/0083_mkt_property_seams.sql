-- 0083_mkt_property_seams.sql — what comes in from the scrape, and what a
-- person decides about it.
--
-- `0082` took the agents. This takes the two acts on either side of them: a
-- file arriving from outside, and the judgements a person makes on what it
-- brought — *worth approaching*, *not a condo*, *I have read the enrichment
-- and I agree with it*.
--
-- ## The import rule, for the fourth time
--
-- A row already here is skipped rather than duplicated, and **nothing is
-- invented for a row that cannot be placed** (D143, D154). A scrape into a
-- city nobody has set up is a decision for a person, not a market this
-- function should conjure — so those rows are counted, their codes are handed
-- back by name, and somebody goes and defines them.
--
-- Where this goes further than the demo: `skipped` is **three different
-- things**, and one number for all of them is a number somebody has to guess
-- at. *Four already here* and *four pointing at a city we have never heard of*
-- are opposite problems — the first is the import working, the second is the
-- import telling you something. Both counts are returned, and `skipped` stays
-- as their sum so nothing that reads it today breaks.
--
-- ## `TL-0004` is minted here, and `0081` says refs are supplied
--
-- Both are true and the seam is where they meet. A property imported from the
-- old tracker arrives **with** its ref, which is why the column is not
-- generated. A property this system promotes out of a scrape row has no
-- outside ref, because no outside system ever knew about it — so it gets the
-- next one in the same series, skipping any the tracker already used.
--
-- Not registered in `ops_core.doc_prefixes`: that table is the registry of
-- **document numbers**, `pr-26-09-11_03` and its shape. `TL-0004` is a
-- tracker's row number and putting it there would be a claim about its shape
-- that is not true.

create sequence ops_mkt.property_ref_seq;

create or replace function ops_mkt.next_property_ref()
returns text
language plpgsql set search_path = ops_mkt, pg_temp as $$
declare v_ref text;
begin
  -- The loop is for the refs that came in from the tracker. A sequence knows
  -- nothing about `TL-0007` arriving in an import, and handing out a ref that
  -- is already on somebody's screen is worse than a gap.
  loop
    v_ref := 'TL-' || lpad(nextval('ops_mkt.property_ref_seq')::text, 4, '0');
    exit when not exists (select 1 from ops_mkt.properties p where p.ref = v_ref);
  end loop;
  return v_ref;
end $$;

-- ── what the scrape found ─────────────────────────────────────────────────
create or replace function ops_mkt.import_scrape(
  p_filename text,
  p_rows     jsonb,
  p_key      text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed  jsonb;
  v_import_id uuid := gen_random_uuid();
  v_added     int;
  v_blank     int;
  v_unknown   int;
  v_dup       int;
  v_repeat    int;
  v_codes     text[];
  v_res       jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','import_scrape', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.create') then
    return ops_core.refused('marketing','scrape', p_filename,'import',
      'not_permitted','Importing the scrape needs marketing access.');
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return ops_core.invalid('marketing','scrape', p_filename,'import',
      'no_rows','Tidak ada baris yang terbaca.', jsonb_build_object('field','rows'));
  end if;

  -- One statement, so every count is taken against the same snapshot: the
  -- insert below cannot make its own rows look like duplicates of themselves.
  with raw as (
    select
      btrim(coalesce(r ->> 'market_code','')) as market_code,
      btrim(coalesce(r ->> 'name',''))        as name,
      nullif(btrim(coalesce(r ->> 'maps_url','')), '') as maps_url,
      coalesce((r ->> 'enriched')::boolean, false)     as enriched,
      ord
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
  ),
  classified as (
    select
      w.*,
      case
        when w.market_code = '' or w.name = '' then 'blank'
        when not exists (select 1 from ops_mkt.markets m where m.code = w.market_code)
          then 'unknown_market'
        when exists (select 1 from ops_mkt.scrape_rows s
                      where s.market_code = w.market_code
                        and lower(s.name) = lower(w.name))
          then 'duplicate'
        else 'new'
      end as verdict,
      -- The same hotel twice **inside one file** is the same duplicate as the
      -- same hotel twice across two runs, and the unique index would refuse
      -- the whole import rather than the second row.
      row_number() over (partition by w.market_code, lower(w.name) order by w.ord) as rn
    from raw w
  ),
  ins as (
    insert into ops_mkt.scrape_rows (market_code, name, maps_url, enriched, import_id)
    select c.market_code, c.name, c.maps_url, c.enriched, v_import_id
      from classified c where c.verdict = 'new' and c.rn = 1
    returning 1
  )
  select
    (select count(*) from ins)::int,
    count(*) filter (where c.verdict = 'blank')::int,
    count(*) filter (where c.verdict = 'unknown_market')::int,
    count(*) filter (where c.verdict = 'duplicate')::int,
    count(*) filter (where c.verdict = 'new' and c.rn > 1)::int,
    -- Named, not merely counted. *Four rows we could not place* sends somebody
    -- looking; `AU-QLD-BRISBANE-CBD` sends them somewhere.
    (array_agg(distinct c.market_code) filter (where c.verdict = 'unknown_market'))
  into v_added, v_blank, v_unknown, v_dup, v_repeat, v_codes
  from classified c;

  perform ops_core.emit('marketing','marketing.scrape.imported', p_filename,
    jsonb_build_object('filename', p_filename, 'import_id', v_import_id,
                       'added', v_added, 'unknown_markets', to_jsonb(coalesce(v_codes, '{}'::text[]))));

  v_res := ops_core.ok('marketing','scrape', p_filename,'import',
    jsonb_build_object(
      'filename',        p_filename,
      'import_id',       v_import_id,
      'added',           v_added,
      -- Kept, and equal to the three below added together.
      'skipped',         v_blank + v_unknown + v_dup + v_repeat,
      'blank',           v_blank,
      'unknown_market',  v_unknown,
      'already_here',    v_dup + v_repeat,
      'unknown_markets', to_jsonb(coalesce(v_codes, '{}'::text[]))));
  return ops_core.idem_remember('marketing','import_scrape', p_key, v_res);
end $$;

-- ── a scraped name becomes a property ─────────────────────────────────────
--
-- Addressed by `(market_code, name)`, which is the row's own unique key and
-- what a person reading the list has in front of them — not the uuid the
-- contract passes (C17, again).
create or replace function ops_mkt.promote_scrape_row(
  p_market_code text,
  p_name        text,
  p_status      text default 'QUALIFIED',
  p_rooms       int  default null,
  p_adr         numeric default null,
  p_score       int  default 0,
  p_notes       text default null,
  p_key         text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_row      ops_mkt.scrape_rows;
  v_ref      text;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','promote_scrape_row', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.create') then
    return ops_core.refused('marketing','property', null,'promote',
      'not_permitted','Promoting a scraped row needs marketing access.');
  end if;

  select s.* into v_row from ops_mkt.scrape_rows s
   where s.market_code = p_market_code and lower(s.name) = lower(btrim(coalesce(p_name,'')));
  if not found then
    return ops_core.not_found('marketing','scrape', null,'promote',
      format('No scraped row for %s in %s.', p_name, p_market_code));
  end if;

  -- Twice would put the same hotel on the list under two refs, and the second
  -- would be approached by somebody who could not see the first. The answer
  -- names the ref it already has, so the caller can go there.
  if v_row.property_ref is not null then
    return ops_core.conflict('marketing','property', v_row.property_ref,'promote',
      'already_promoted', format('%s sudah jadi %s.', v_row.name, v_row.property_ref));
  end if;

  if p_score is not null and (p_score < 0 or p_score > 5) then
    return ops_core.invalid('marketing','property', null,'promote',
      'score_out_of_range','Skor enrichment antara 0 dan 5. Nol berarti belum dinilai, bukan jelek.',
      jsonb_build_object('field','score'));
  end if;

  -- `DISQUALIFIED` with nothing after it is the one status the table refuses,
  -- and it is the one a caller is most likely to send. Said here it names the
  -- field rather than the constraint.
  if coalesce(btrim(coalesce(p_status,'')), '') <> 'QUALIFIED'
     and coalesce(btrim(coalesce(p_status,'')), '') !~ '^DISQUALIFIED — .+$' then
    return ops_core.invalid('marketing','property', null,'promote',
      'bad_status',
      'Status hanya QUALIFIED, atau DISQUALIFIED — beserta alasannya. '
      'Alasan itu yang dibaca setahun lagi ketika ada yang bertanya kenapa dilewati.',
      jsonb_build_object('field','status'));
  end if;

  v_ref := ops_mkt.next_property_ref();

  insert into ops_mkt.properties
    (ref, market_code, name, maps_url, status, rooms, adr, score, notes, import_id)
  values (v_ref, v_row.market_code, v_row.name, v_row.maps_url,
          btrim(p_status), p_rooms, p_adr, coalesce(p_score, 0),
          nullif(btrim(coalesce(p_notes,'')), ''), v_row.import_id);
  -- **`validated` is not set here, and cannot be.** The score and the
  -- enrichment come from outside; agreeing with them is a person's act with
  -- their name on it (D184), and promoting a row is not that act.

  update ops_mkt.scrape_rows set property_ref = v_ref where id = v_row.id;

  perform ops_core.emit('marketing','marketing.property.promoted', v_ref,
    jsonb_build_object('ref', v_ref, 'name', v_row.name, 'market_code', v_row.market_code));

  v_res := ops_core.ok('marketing','property', v_ref,'promote',
    jsonb_build_object(
      'ref',         v_ref,
      'name',        v_row.name,
      'market_code', v_row.market_code,
      'status',      btrim(p_status),
      'score',       coalesce(p_score, 0),
      'validated',   false));
  return ops_core.idem_remember('marketing','promote_scrape_row', p_key, v_res);
end $$;

-- ── somebody read the enrichment and agrees with it ───────────────────────
--
-- Until this, the score is a machine's opinion and the screen says so (D184).
-- The team acts on unvalidated rows — waiting would stall the week — and the
-- whole value of the column is that it never lets them forget which is which.
create or replace function ops_mkt.validate_property(
  p_ref       text,
  p_validated boolean default true,
  p_notes     text default null,
  p_key       text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_prop     ops_mkt.properties;
  v_before   boolean;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','validate_property', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','property', p_ref,'validate',
      'not_permitted','Validating an enrichment needs marketing access.');
  end if;

  select p.* into v_prop from ops_mkt.properties p where p.ref = p_ref;
  if not found then
    return ops_core.not_found('marketing','property', p_ref,'validate',
      format('No property %s.', p_ref));
  end if;
  v_before := v_prop.validated;

  update ops_mkt.properties
     set validated    = coalesce(p_validated, true),
         -- The signature goes on and comes off together with the claim — the
         -- table's own `validation_is_signed` says the same, and this is the
         -- only writer that can get it right without being told.
         validated_by = case when coalesce(p_validated, true) then auth.uid() end,
         validated_at = case when coalesce(p_validated, true) then now() end,
         notes        = coalesce(nullif(btrim(coalesce(p_notes,'')), ''), notes)
   where ref = p_ref
  returning * into v_prop;

  v_res := ops_core.ok('marketing','property', p_ref,
    case when v_prop.validated then 'validate' else 'unvalidate' end,
    jsonb_build_object(
      'ref',          p_ref,
      'validated',    v_prop.validated,
      'validated_at', v_prop.validated_at,
      'score',        v_prop.score),
    jsonb_build_object('validated', v_before),
    jsonb_build_object('validated', v_prop.validated));
  return ops_core.idem_remember('marketing','validate_property', p_key, v_res);
end $$;

-- ── worth approaching, or not, and why not ────────────────────────────────
--
-- The status column holds `QUALIFIED` or `DISQUALIFIED — <reason>`, verbatim as
-- the tracker writes it, because a boolean and a separate note would let the
-- reason go missing and *why did we drop this one* is the question asked a year
-- later. Composing that string is the kind of thing every caller would do
-- slightly differently, so no caller does it.
create or replace function ops_mkt.set_property_status(
  p_ref       text,
  p_qualified boolean,
  p_reason    text default null,
  p_key       text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_prop     ops_mkt.properties;
  v_before   text;
  v_status   text;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','set_property_status', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','property', p_ref,'set_status',
      'not_permitted','Qualifying a property needs marketing access.');
  end if;

  select p.* into v_prop from ops_mkt.properties p where p.ref = p_ref;
  if not found then
    return ops_core.not_found('marketing','property', p_ref,'set_status',
      format('No property %s.', p_ref));
  end if;
  v_before := v_prop.status;

  if not coalesce(p_qualified, false)
     and coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return ops_core.invalid('marketing','property', p_ref,'set_status',
      'reason_required',
      'Tulis alasannya — DISQUALIFIED tanpa alasan tidak bisa dibaca setahun lagi.',
      jsonb_build_object('field','reason'));
  end if;

  v_status := case when coalesce(p_qualified, false) then 'QUALIFIED'
                   else 'DISQUALIFIED — ' || upper(btrim(p_reason)) end;

  update ops_mkt.properties set status = v_status where ref = p_ref;

  v_res := ops_core.ok('marketing','property', p_ref,'set_status',
    jsonb_build_object('ref', p_ref, 'status', v_status,
                       'qualified', coalesce(p_qualified, false)),
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', v_status));
  return ops_core.idem_remember('marketing','set_property_status', p_key, v_res);
end $$;

grant usage, select on sequence ops_mkt.property_ref_seq to authenticated;
grant execute on function
  ops_mkt.next_property_ref(),
  ops_mkt.import_scrape(text, jsonb, text),
  ops_mkt.promote_scrape_row(text, text, text, int, numeric, int, text, text),
  ops_mkt.validate_property(text, boolean, text, text),
  ops_mkt.set_property_status(text, boolean, text, text)
  to authenticated;
