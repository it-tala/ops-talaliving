-- 0084_mkt_referral_seams.sql — the second funnel's writing side, and the one
-- act that has to happen before any of it: defining a market.
--
-- `0082` took the agents and `0083` the properties. What is left is the half
-- with money in it — an owner a representative introduced, how far that got,
-- and which ledger row eventually paid the commission — plus the act `0083`
-- keeps asking for by name. An import that reports *two rows for
-- `AU-QLD-BRISBANE-CBD`, a city nobody has set up* is telling somebody to go
-- and set it up, and until now there was no way to.
--
-- ## One thing `0080` left open, closed here with a trigger
--
-- The rate a representative is paid at freezes once anything has been paid
-- against it, because moving it restates commissions the ledger has settled.
-- The **project** a referral points at was not protected the same way, and it
-- is the other half of the same multiplication: re-point a paid referral at a
-- larger contract and `commission_amount` grows past what the bank actually
-- sent. Same argument, same answer — see F118.

-- ── where in the world, before anything can be scraped into it ────────────
--
-- The code is the caller's, not derived. It is tempting to build
-- `AU-QLD-GOLDCOAST-SPNORTH` out of the fields and make the prefix rule
-- impossible to break, and it does not work: the second segment is `QLD` while
-- the region reads *Queensland*, and nothing here knows one from the other. So
-- the seam validates instead, and says which part is wrong rather than which
-- constraint fired.
create or replace function ops_mkt.create_market(
  p_code         text,
  p_country_code text,
  p_country_name text,
  p_city         text,
  p_area_label   text,
  p_currency     text,
  p_timezone     text,
  p_region       text default null,
  p_language     text default 'en',
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_code     text := upper(btrim(coalesce(p_code,'')));
  v_country  text := upper(btrim(coalesce(p_country_code,'')));
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','create_market', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.create') then
    return ops_core.refused('marketing','market', v_code,'create',
      'not_permitted','Defining a market needs marketing access.');
  end if;

  if v_country !~ '^[A-Z]{2}$' then
    return ops_core.invalid('marketing','market', v_code,'create',
      'bad_country_code','Kode negara dua huruf, ISO-3166: AU, ID, AE.',
      jsonb_build_object('field','country_code'));
  end if;
  if upper(btrim(coalesce(p_currency,''))) !~ '^[A-Z]{3}$' then
    return ops_core.invalid('marketing','market', v_code,'create',
      'bad_currency','Kode mata uang tiga huruf, ISO-4217: AUD, IDR, AED.',
      jsonb_build_object('field','currency'));
  end if;
  -- Every filter in this module is a **prefix** of the code (D187). A code that
  -- does not begin with its own country is not refused because it is untidy —
  -- it is refused because the market would be missing from every country
  -- roll-up and nothing anywhere would raise.
  if v_code !~ ('^' || v_country || '-') then
    return ops_core.invalid('marketing','market', v_code,'create',
      'code_must_start_with_country',
      format('Kode pasar harus diawali %s-, karena setiap filter negara, kota dan '
             'distrik adalah awalan dari kode ini. %s tidak akan pernah muncul di '
             'laporan negaranya.', v_country, v_code),
      jsonb_build_object('field','code'));
  end if;
  if array_length(string_to_array(v_code, '-'), 1) < 3 then
    return ops_core.invalid('marketing','market', v_code,'create',
      'code_too_short',
      'Kode pasar: NEGARA[-WILAYAH]-KOTA-AREA. Tanpa kota dan area, tidak ada '
      'yang bisa difilter di bawah negara.',
      jsonb_build_object('field','code'));
  end if;
  -- Asked here so the answer is a sentence. The trigger on the table says the
  -- same thing and is what holds for anything that does not come through here.
  begin
    perform now() at time zone btrim(coalesce(p_timezone,''));
  exception when others then
    return ops_core.invalid('marketing','market', v_code,'create',
      'bad_timezone',
      format('%s bukan zona waktu yang dikenal. "Jam berapa di sana" adalah satu-satunya '
             'pertanyaan yang tidak bisa dijawab oleh daftar nama.', p_timezone),
      jsonb_build_object('field','timezone'));
  end;

  if exists (select 1 from ops_mkt.markets m where m.code = v_code) then
    return ops_core.conflict('marketing','market', v_code,'create',
      'market_exists', format('Pasar %s sudah ada.', v_code));
  end if;

  insert into ops_mkt.markets
    (code, country_code, country_name, region, city, area_label, currency, timezone, language)
  values (v_code, v_country, btrim(p_country_name), nullif(btrim(coalesce(p_region,'')), ''),
          btrim(p_city), btrim(p_area_label), upper(btrim(p_currency)),
          btrim(p_timezone), coalesce(nullif(btrim(coalesce(p_language,'')), ''), 'en'));

  v_res := ops_core.ok('marketing','market', v_code,'create',
    (select to_jsonb(v) - 'properties' - 'scraped'
       from ops_mkt.v_market v where v.code = v_code));
  return ops_core.idem_remember('marketing','create_market', p_key, v_res);
end $$;

-- A market we have stopped working. The rows stay — a property scraped in
-- Brisbane last year is still a fact about Brisbane (A5) — and `active` is what
-- keeps it off the list of places to scrape next.
create or replace function ops_mkt.set_market_active(
  p_code text, p_active boolean, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare v_replayed jsonb; v_before boolean; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','set_market_active', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','market', p_code,'set_active',
      'not_permitted','Retiring a market needs marketing access.');
  end if;

  select m.active into v_before from ops_mkt.markets m where m.code = p_code;
  if not found then
    return ops_core.not_found('marketing','market', p_code,'set_active',
      format('No market %s.', p_code));
  end if;

  update ops_mkt.markets set active = coalesce(p_active, true) where code = p_code;

  v_res := ops_core.ok('marketing','market', p_code,'set_active',
    jsonb_build_object('code', p_code, 'active', coalesce(p_active, true)),
    jsonb_build_object('active', v_before),
    jsonb_build_object('active', coalesce(p_active, true)));
  return ops_core.idem_remember('marketing','set_market_active', p_key, v_res);
end $$;

-- ── a paid referral cannot be re-pointed ──────────────────────────────────
--
-- `commission_amount` is the project's contract value times the rep's rate,
-- derived on every read and stored nowhere (A3, C15). `0080` froze the rate
-- once something had been paid against it. The project is the **other factor**
-- in that multiplication and was left open: re-point a settled referral at a
-- larger contract and the figure grows past what the bank actually sent, with
-- nothing anywhere saying so.
--
-- A trigger rather than a check in the seam, for the reason every invariant
-- here is: it has to hold for a correction typed straight into the table.
create or replace function ops_mkt.paid_referral_is_pinned()
returns trigger
language plpgsql set search_path = ops_mkt, pg_temp as $$
begin
  if old.commission_trx_no is null then return new; end if;

  if new.project_code is distinct from old.project_code then
    raise exception 'referral % was paid on %; its project cannot be changed to % — the commission the ledger settled was a percentage of %',
      old.referral_no, old.commission_trx_no, coalesce(new.project_code,'(none)'), old.project_code
      using errcode = 'check_violation';
  end if;
  -- And the payment itself is a fact, not a field. A correction is another
  -- ledger row, the same as everywhere else (A2, A5).
  if new.commission_trx_no is distinct from old.commission_trx_no then
    raise exception 'referral % was paid on %; which row paid it is a fact, and a correction is another ledger entry',
      old.referral_no, old.commission_trx_no using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger paid_referral_is_pinned
  before update on ops_mkt.referrals
  for each row execute function ops_mkt.paid_referral_is_pinned();

-- ── an owner the representative introduced ────────────────────────────────
create or replace function ops_mkt.add_referral(
  p_rep_no       text,
  p_owner_name   text,
  p_unit         text default null,
  p_property_ref text default null,
  p_phone        text default null,
  p_note         text default null,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_rep      ops_mkt.sales_reps;
  v_no       text;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','add_referral', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.create') then
    return ops_core.refused('marketing','referral', null,'create',
      'not_permitted','Recording an introduction needs marketing access.');
  end if;

  if coalesce(btrim(coalesce(p_owner_name,'')), '') = '' then
    return ops_core.invalid('marketing','referral', null,'create',
      'owner_required','Tulis nama pemiliknya.', jsonb_build_object('field','owner_name'));
  end if;

  select s.* into v_rep from ops_mkt.sales_reps s where s.rep_no = p_rep_no;
  if not found then
    return ops_core.not_found('marketing','referral', null,'create',
      format('No representative %s.', p_rep_no));
  end if;

  -- A code that names nothing is a 404, not a silent null — `create_pr` made
  -- the same call about a project code (D84's file), for the same reason: an
  -- introduction filed against the wrong unit is worse than one filed against
  -- none.
  if p_property_ref is not null
     and not exists (select 1 from ops_mkt.properties p where p.ref = p_property_ref) then
    return ops_core.not_found('marketing','referral', null,'create',
      format('No property %s.', p_property_ref));
  end if;

  v_no := ops_core.next_doc_number('lead');

  insert into ops_mkt.referrals
    (referral_no, rep_id, owner_name, unit, property_ref, phone, note, created_by)
  values (v_no, v_rep.id, btrim(p_owner_name),
          nullif(btrim(coalesce(p_unit,'')), ''), p_property_ref,
          nullif(btrim(coalesce(p_phone,'')), ''),
          nullif(btrim(coalesce(p_note,'')), ''), auth.uid());

  v_res := ops_core.ok('marketing','referral', v_no,'create',
    jsonb_build_object(
      'referral_no', v_no,
      'rep_no',      v_rep.rep_no,
      'owner_name',  btrim(p_owner_name),
      'status',      'LEAD',
      -- **Warned, not refused** (A6). Recording an introduction against a rep
      -- we have stopped working with is odd rather than impossible, and the
      -- screen is where that conversation happens.
      'rep_active',  v_rep.active));
  return ops_core.idem_remember('marketing','add_referral', p_key, v_res);
end $$;

-- ── how far the introduction got ──────────────────────────────────────────
--
-- **No `contract_value` parameter**, and that absence is C15: the value is the
-- project's, read through the code, and a second copy typed in here is the one
-- that goes stale the first time a contract is revised.
create or replace function ops_mkt.set_referral_status(
  p_referral_no text,
  p_status      ops_mkt.referral_status_t,
  p_project_code text default null,
  p_lost_reason  text default null,
  p_note         text default null,
  p_key          text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare
  v_replayed jsonb;
  v_ref      ops_mkt.referrals;
  v_before   ops_mkt.referral_status_t;
  v_value    numeric;
  v_res      jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','set_referral_status', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','referral', p_referral_no,'set_status',
      'not_permitted','Moving an introduction along needs marketing access.');
  end if;

  select r.* into v_ref from ops_mkt.referrals r where r.referral_no = p_referral_no;
  if not found then
    return ops_core.not_found('marketing','referral', p_referral_no,'set_status',
      format('No referral %s.', p_referral_no));
  end if;
  v_before := v_ref.status;

  -- Settled, and therefore finished. Everything below would either strand the
  -- payment or restate it.
  if v_ref.commission_trx_no is not null and p_status <> 'WON' then
    return ops_core.invalid('marketing','referral', p_referral_no,'set_status',
      'already_paid',
      format('Komisi %s sudah dibayar lewat %s. Statusnya tidak bisa mundur dari WON — '
             'koreksinya adalah entri jurnal lain.', p_referral_no, v_ref.commission_trx_no),
      jsonb_build_object('trx_no', v_ref.commission_trx_no));
  end if;

  if p_status = 'WON' then
    if coalesce(btrim(coalesce(p_project_code, v_ref.project_code, '')), '') = '' then
      return ops_core.invalid('marketing','referral', p_referral_no,'set_status',
        'project_required',
        'Proyek yang jadi harus punya kode proyek — komisinya dihitung dari kontrak '
        'yang benar-benar ada.', jsonb_build_object('field','project_code'));
    end if;
    select p.contract_value into v_value
      from ops_procure.projects p
     where p.code = coalesce(btrim(p_project_code), v_ref.project_code);
    if not found then
      return ops_core.not_found('marketing','referral', p_referral_no,'set_status',
        format('No project %s.', coalesce(btrim(p_project_code), v_ref.project_code)));
    end if;
    -- The trigger from `0080` refuses this too. Said here it names the figure
    -- that is missing and where to go and put it.
    if v_value is null or v_value <= 0 then
      return ops_core.invalid('marketing','referral', p_referral_no,'set_status',
        'value_required',
        format('Isi nilai kontrak proyek %s dulu. Komisi dari nilai yang belum ada '
               'adalah angka yang tidak bisa dicek.',
               coalesce(btrim(p_project_code), v_ref.project_code)),
        jsonb_build_object('field','contract_value'));
    end if;
  end if;

  if p_status = 'LOST'
     and coalesce(btrim(coalesce(p_lost_reason, v_ref.lost_reason, '')), '') = '' then
    return ops_core.invalid('marketing','referral', p_referral_no,'set_status',
      'reason_required',
      'Tulis kenapa batal — ini yang dibaca ketika pemilik yang sama muncul lagi.',
      jsonb_build_object('field','lost_reason'));
  end if;

  update ops_mkt.referrals
     set status       = p_status,
         project_code = case when p_status = 'WON'
                             then coalesce(nullif(btrim(coalesce(p_project_code,'')), ''), project_code)
                             else project_code end,
         lost_reason  = coalesce(nullif(btrim(coalesce(p_lost_reason,'')), ''), lost_reason),
         note         = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note),
         updated_at   = now()
   where referral_no = p_referral_no
  returning * into v_ref;

  if p_status = 'WON' then
    perform ops_core.emit('marketing','marketing.referral.won', p_referral_no,
      jsonb_build_object('referral_no', p_referral_no, 'project_code', v_ref.project_code));
  end if;

  v_res := ops_core.ok('marketing','referral', p_referral_no,'set_status',
    (select jsonb_build_object(
       'referral_no',       v.referral_no,
       'status',            v.status,
       'project_code',      v.project_code,
       'contract_value',    v.contract_value,
       -- Handed back rather than left to a re-read: the caller moved a status
       -- and the thing they actually want to know is what it is now worth.
       'commission_amount', v.commission_amount)
       from ops_mkt.v_referral v where v.referral_no = p_referral_no),
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', v_ref.status));
  return ops_core.idem_remember('marketing','set_referral_status', p_key, v_res);
end $$;

-- ── which ledger row paid it ──────────────────────────────────────────────
--
-- This module records what is **owed** and never pays it (D186). Paying is the
-- ledger's act, like any other money; this only records which row did it, so
-- `commission_unpaid` stops counting it.
--
-- The `trx_no` is **not verified**, and that is not laziness. `ops_acct.transactions`
-- is `accounting.read`, which the person recording this does not hold, and a
-- `security definer` check would answer *no such transaction* for a row that
-- exists and is simply not theirs to see — the plausible-null failure this
-- project keeps finding (F104), turned into a plausible refusal. A public code
-- across a seam is the reference (ADR-004); reconciling the two sides is
-- accounting's own report to write.
create or replace function ops_mkt.record_commission_paid(
  p_referral_no text, p_trx_no text, p_key text default null)
returns jsonb
language plpgsql security definer set search_path = ops_mkt, ops_core, pg_temp as $$
declare v_replayed jsonb; v_ref ops_mkt.referrals; v_amount bigint; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('marketing','record_commission_paid', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('marketing.update') then
    return ops_core.refused('marketing','referral', p_referral_no,'record_paid',
      'not_permitted','Recording a commission payment needs marketing access.');
  end if;

  if coalesce(btrim(coalesce(p_trx_no,'')), '') = '' then
    return ops_core.invalid('marketing','referral', p_referral_no,'record_paid',
      'trx_required','Nomor jurnal mana yang membayarnya? Tanpa itu ini bukan catatan pembayaran.',
      jsonb_build_object('field','trx_no'));
  end if;

  select r.* into v_ref from ops_mkt.referrals r where r.referral_no = p_referral_no;
  if not found then
    return ops_core.not_found('marketing','referral', p_referral_no,'record_paid',
      format('No referral %s.', p_referral_no));
  end if;

  if v_ref.status <> 'WON' then
    return ops_core.invalid('marketing','referral', p_referral_no,'record_paid',
      'not_won','Tidak ada komisi atas perkenalan yang belum jadi proyek.',
      jsonb_build_object('status', v_ref.status));
  end if;
  if v_ref.commission_trx_no is not null then
    return ops_core.conflict('marketing','referral', p_referral_no,'record_paid',
      'already_paid',
      format('%s sudah dibayar lewat %s.', p_referral_no, v_ref.commission_trx_no));
  end if;

  select v.commission_amount into v_amount
    from ops_mkt.v_referral v where v.referral_no = p_referral_no;

  update ops_mkt.referrals
     set commission_trx_no = btrim(p_trx_no), updated_at = now()
   where referral_no = p_referral_no;

  perform ops_core.emit('marketing','marketing.commission.paid', p_referral_no,
    jsonb_build_object('referral_no', p_referral_no, 'trx_no', btrim(p_trx_no),
                       'amount', v_amount));

  v_res := ops_core.ok('marketing','referral', p_referral_no,'record_paid',
    jsonb_build_object('referral_no', p_referral_no, 'trx_no', btrim(p_trx_no),
                       'amount', v_amount));
  return ops_core.idem_remember('marketing','record_commission_paid', p_key, v_res);
end $$;

grant execute on function
  ops_mkt.create_market(text, text, text, text, text, text, text, text, text, text),
  ops_mkt.set_market_active(text, boolean, text),
  ops_mkt.add_referral(text, text, text, text, text, text, text),
  ops_mkt.set_referral_status(text, ops_mkt.referral_status_t, text, text, text, text),
  ops_mkt.record_commission_paid(text, text, text)
  to authenticated;
