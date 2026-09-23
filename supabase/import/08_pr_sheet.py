#!/usr/bin/env python3
"""08_pr_sheet.py — the purchase-request recap tabs, read into SQL.

Reads three tabs of the `2026 PURCHASE-PAYMENT TRACKER` workbook and writes
`08_purchase_requests.sql`:

    AUGUST PR RECAP  ·  APROVE PR-27082026  ·  SEPTEMBER PR RECAP

The SQL file is the reviewable artifact. This script is kept beside it so the
reading of the sheet (which rows are one line, which transaction paid which
line) can be argued with and re-run, rather than living only in a diff.

    python3 supabase/import/08_pr_sheet.py tracker.xlsx ledger.json > supabase/import/08_purchase_requests.sql

`tracker.xlsx` is the workbook exported from Drive. `ledger.json` is the live
ledger, one array per transaction, from:

    select json_agg(json_build_array(t.trx_no, t.trx_date, a.code, t.direction,
                    t.amount_idr, t.type_code, v.name, left(t.description, 80),
                    t.status) order by t.trx_no)
      from ops_acct.transactions t
      join ops_acct.accounts a on a.id = t.account_id
      left join ops_procure.vendors v on v.id = t.vendor_id
     where t.trx_date >= '2026-07-25';

── One line, three tabs ──────────────────────────────────────────────────

The tabs are not three sets of lines. A line not paid in one recap was copied
into the next, so `SEALER PU` of 15 Aug is a row in AUGUST (unapproved) and
again in APROVE 27-08 (approved, released 28 Aug). Rows are the same line when
their request date and description agree once punctuation is stripped, plus the
ten pairs in MERGE whose description was edited on the way (`CONNECTOR` became
`CONNECTOR FITTING LAMPU LT-02`). The latest tab's copy wins for amounts,
approval and payment; the line number comes from whichever copy carried one.

── When it was approved, and so when it was paid ─────────────────────────

The owner's rule for this import: **the day a line was paid is the day it was
approved.** The approval date is read, in order, from:

  1. AUGUST's `APPROVAL METADATA` (`approved by … at 11/08/2026 15:39 WIB`);
  2. APROVE 27-08's release columns (`28 AGUSTUS 2026`, `31 AGUSTUS 2026`,
     `2026-09-01`) — the day that tab released the money;
  3. otherwise the date of the ledger transaction that paid it — the rule
     applied the other way round;
  4. otherwise the request date.

The ledger is then searched from that day: an OUT transaction for the paid
amount to the rupiah, up to 3 days before and 21 after, preferring the one
whose description and vendor share words with the line. The `TRX ID` the sheet
already carries wins over any search. MANUAL holds the twenty-one the search could
not settle on its own, each with its reason; REJECT the four it settled wrongly.
"""
import datetime as dt
import itertools
import json
import re
import sys
from collections import Counter, defaultdict

import openpyxl

TABS = ['AUGUST PR RECAP', 'APROVE PR-27082026', 'SEPTEMBER PR RECAP']
ABBR = {'AUGUST PR RECAP': 'AUG', 'APROVE PR-27082026': 'APR', 'SEPTEMBER PR RECAP': 'SEP'}

# Same line, description edited between tabs.
MERGE = [('AUG128', 'APR11'), ('AUG137', 'APR18'), ('AUG138', 'APR19'), ('AUG143', 'APR23'),
         ('AUG144', 'APR24'), ('AUG170', 'APR39'), ('AUG171', 'APR40'), ('AUG174', 'APR37'),
         ('AUG180', 'APR45'), ('AUG158', 'SEP41')]

# (sheet row, trx_no, why) — read by hand against the ledger.
MANUAL = [
    ('AUG103', 'trx-26-08-26_015', 'one transaction pays both URECEL lines; ledger Rp 8 under'),
    ('AUG104', 'trx-26-08-26_015', 'one transaction pays both URECEL lines; ledger Rp 8 under'),
    ('AUG123', 'trx-26-08-26_078', 'payroll week 3; ledger Rp 200.000 over'),
    ('AUG117', 'trx-26-08-26_083', 'sewa Gran Max Agustus'),
    ('AUG150', 'trx-26-08-26_054', 'selang murtipurpus, Santoso Diesel'),
    ('AUG153', 'trx-26-08-26_087', 'one transaction pays V-Legal and its PNBP'),
    ('AUG154', 'trx-26-08-26_087', 'one transaction pays V-Legal and its PNBP'),
    ('AUG157', 'trx-26-08-26_091', 'Inocycle; ledger Rp 500 over'),
    ('SEP41',  'trx-26-09-10_010', 'balance stool Jawul; ledger Rp 8.000 over'),
    ('APR36',  'trx-26-08-31_019', 'listrik Saripan; ledger Rp 4.000 over'),
    ('SEP8',   'trx-26-09-09_002', 'N8N, debited from Jago'),
    ('SEP12',  'trx-26-09-09_005', 'Timelines AI, debited from Jago'),
    ('SEP13',  'trx-26-09-09_006', 'Starlink, debited from Jago'),
    ('SEP14',  'trx-26-09-11_001', 'Claude Max shared, debited from Jago'),
    ('SEP16',  'trx-26-09-17_135', 'Claude Max Ejo, debited from Jago'),
    ('SEP15',  'trx-26-09-10_035', 'Google One (AI Pro 5TB), debited from Jago'),
    ('SEP21',  'trx-26-09-10_006', 'thinner PU 19L'),
    ('SEP24',  'trx-26-09-08_055', 'rental mesin fotocopy September'),
    ('SEP47',  'trx-26-09-10_032', 'thinner NC 9 Sep; ledger Rp 1.480.000'),
    ('SEP58',  'trx-26-09-17_015', 'semen; ledger Rp 148.000'),
    ('SEP61',  'trx-26-09-17_018', 'obat cor is the obat semen; ledger Rp 65.000'),
]

# (sheet row, trx_no) pairs the amount search proposed and a reading refused.
REJECT = {('SEP33', 'trx-26-09-08_040'), ('SEP21', 'trx-26-09-01_061'),
          ('SEP58', 'trx-26-09-17_036'), ('SEP61', 'trx-26-09-10_047')}

STOP = {'PAYMENT', 'PYMENT', 'BALANCE', 'PT', 'CV', 'TOKO', 'UD', 'THE', 'FOR', 'DAN', 'KE', 'INC',
        'PCS', 'PO', 'BCA', 'BNI', 'OUT', 'IN', 'TRANSFER', 'FEE', 'ADMIN', 'CM', 'MM', 'X'}
SYN = {'TINER': 'TINNER', 'THINNER': 'TINNER', 'AQUA': 'GALON', 'FOAMSHETT': 'FOAMSHEET',
       'WARP': 'WRAP', 'LISTRIK': 'ELECTRICITY', 'ELECETRICITY': 'ELECTRICITY', 'SEKRUP': 'SCREW',
       'SKREUP': 'SCREW', 'MATRAI': 'MATERAI', 'KONTRAKTOR': 'KONTAKTOR', 'ZHANCEN': 'ZHANCHEN',
       'RISKY': 'RIZKY', 'SUWAR': 'SUAR', 'SWAR': 'SUAR', 'GRANDMAX': 'GRANMAX',
       'ALUMUNIUM': 'ALUMINIUM', 'ALUMINUM': 'ALUMINIUM', 'FISER': 'FISHER', 'CINTIA': 'CYNTHIA',
       'KOMRESOR': 'KOMPRESOR'}


def num(v):
    try:
        return None if v in (None, '') else float(v)
    except (TypeError, ValueError):
        return None


def read_rows(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    rows = []
    for tab in TABS:
        grid = list(wb[tab].iter_rows(values_only=True))
        hdr = [str(h).strip() if h is not None else '' for h in grid[5]]
        prev_date = None
        for i, r in enumerate(grid[6:], 7):
            # Two columns are both called REMARK on SEPTEMBER; the second is col 23.
            d = {}
            for j, v in enumerate(r):
                if v in (None, '') or not hdr[j]:
                    if v not in (None, '') and not hdr[j]:
                        d['c%d' % j] = v
                    continue
                key = hdr[j] if hdr.count(hdr[j]) == 1 or j == hdr.index(hdr[j]) else hdr[j] + '#2'
                d[key] = v
            if not d.get('DESCRIPTION'):
                continue
            date = str(d.get('DATE') or '')[:10]
            filled = not date
            date = date or prev_date
            prev_date = date
            rows.append(dict(
                ref=ABBR[tab] + str(i), tab=tab, row=i, date=date, date_filled=filled,
                req=d.get('REQUESTED BY'), project=d.get('PROJECT'), cat=d.get('CATEGORY'),
                desc=str(d['DESCRIPTION']).strip(), remark=d.get('REMARK'), ket=d.get('KETERANGAN'),
                vendor=(str(d['VENDOR']).strip() if d.get('VENDOR') else None),
                qty=num(d.get('QTY')), unit=d.get('UNIT'), price=num(d.get('PRICE')),
                idr=num(d.get('IDR AMOUNT')), paid=num(d.get('PAID AMOUNT')),
                approved=d.get('EJO APPROVAL') in (True, 'True', 'TRUE'),
                meta=d.get('APPROVAL METADATA'), change=d.get('LATEST CHANGE'),
                line_id=d.get('LINE ID'), trx=d.get('TRX ID'),
                rel=[(day, num(d.get(col))) for col, day in
                     (('28 AGUSTUS 2026', '2026-08-28'), ('31 AGUSTUS 2026', '2026-08-31'),
                      ('2026-09-01 00:00:00', '2026-09-01')) if num(d.get(col))],
            ))
    return rows


def canonical(rows):
    par = {r['ref']: r['ref'] for r in rows}

    def find(a):
        while par[a] != a:
            a = par[a]
        return a

    def union(a, b):
        par[find(a)] = find(b)

    by = defaultdict(list)
    for r in rows:
        by[(r['date'], re.sub(r'[^A-Z0-9]', '', r['desc'].upper()))].append(r['ref'])
    for refs in by.values():
        first = {}
        for ref in refs:  # two rows in the same tab are two lines, never one
            first.setdefault(ref[:3], ref)
        vals = list(first.values())
        for ref in vals[1:]:
            union(ref, vals[0])
    for a, b in MERGE:
        union(a, b)

    groups = defaultdict(list)
    for r in rows:
        groups[find(r['ref'])].append(r)
    lines = []
    for g in groups.values():
        g.sort(key=lambda r: TABS.index(r['tab']))
        c = dict(g[-1])
        c['refs'] = [r['ref'] for r in g]
        c['line_id'] = next((r['line_id'] for r in g if r['line_id']), None)
        c['trx'] = next((r['trx'] for r in g if r['trx']), None)
        c['req_date'] = min(r['date'] for r in g)
        for fld in ('vendor', 'req', 'project', 'cat', 'unit', 'remark', 'ket', 'qty', 'price', 'idr'):
            if c.get(fld) in (None, ''):
                c[fld] = next((r[fld] for r in reversed(g) if r.get(fld) not in (None, '')), None)
        # approval: metadata, then release column, then (after matching) the ledger
        c['appr_at'] = c['appr_how'] = None
        for r in reversed(g):
            m = re.search(r'approved by (\S+) at (\d\d)/(\d\d)/(\d{4}) (\d\d:\d\d)', str(r['meta'] or ''))
            if r['tab'] == 'AUGUST PR RECAP' and r['approved'] and m:
                c['appr_at'] = f'{m[4]}-{m[3]}-{m[2]} {m[5]}'
                c['appr_how'] = 'AUGUST PR RECAP approval metadata'
                # `approved by unknown` still dates the tick; the box is EJO's
                c['appr_by'] = m[1] if '@' in m[1] else None
                break
            if r['tab'] == 'APROVE PR-27082026' and r['approved'] and r['rel']:
                c['appr_at'] = r['rel'][0][0] + ' 12:00'
                c['appr_how'] = 'APROVE PR-27082026 release column'
                break
        m = re.search(r'(\S+@\S+) changed PRICE from .* to "\(blank\)" at (\d\d)/(\d\d)/(\d{4}) (\d\d:\d\d)',
                      str(c.get('change') or ''))
        c['cancelled'] = (str(c.get('remark') or '').strip().upper() == 'CANCEL' and not c['paid'])
        c['cancel_at'] = f'{m[4]}-{m[3]}-{m[2]} {m[5]}' if (c['cancelled'] and m) else None
        c['cancel_by'] = m[1] if (c['cancelled'] and m) else None
        lines.append(c)
    lines.sort(key=lambda c: (c['req_date'], TABS.index(c['tab']), c['row']))
    return lines


def toks(s):
    out = set()
    for t in re.findall(r'[A-Z0-9]+', str(s or '').upper()):
        t = SYN.get(t, t)
        if len(t) > 1 and t not in STOP:
            out.add(t)
    return out


def match(lines, ledger):
    by_no = {t[0]: t for t in ledger}
    out = [t for t in ledger if t[3] == 'OUT' and t[8] != 'VOID']
    used = set()
    by_ref = {r: c for c in lines for r in c['refs']}
    for c in lines:
        c['alloc'] = []
        if c['trx']:
            c['alloc'] = [[c['trx'], None, 'TRX ID on the sheet']]
            used.add(c['trx'])
    for ref, trx, why in MANUAL:
        by_ref[ref]['alloc'].append([trx, None, 'read by hand: ' + why])
        used.add(trx)

    D = dt.date.fromisoformat

    def anchor(c):
        return D((c['appr_at'] or c['req_date'])[:10])

    def ov(c, t):
        return len(toks(c['desc']) & toks(t[7])) * 3 + len(toks(c['vendor']) & (toks(t[6]) | toks(t[7]))) * 2

    def dd(c, t):
        return (D(t[1]) - anchor(c)).days

    def run(minov, maxdd, uniq, how):
        pairs = []
        for i, c in enumerate(lines):
            if c['alloc'] or not c['paid']:
                continue
            cands = [(ov(c, t) - abs(dd(c, t)) * 0.3, i, t) for t in out
                     if t[0] not in used and round(t[4]) == round(c['paid'])
                     and -3 <= dd(c, t) <= min(21, maxdd) and abs(dd(c, t)) <= maxdd
                     and ov(c, t) >= minov and (c['refs'][-1], t[0]) not in REJECT]
            if uniq and len(cands) > 1:
                continue
            pairs += cands
        pairs.sort(key=lambda p: -p[0])
        for _, i, t in pairs:
            if lines[i]['alloc'] or t[0] in used:
                continue
            lines[i]['alloc'] = [[t[0], None, how]]
            used.add(t[0])

    run(5, 21, False, 'same amount, description and vendor agree')
    run(2, 21, False, 'same amount, description partly agrees')
    run(0, 2, True, 'same amount within two days, the only candidate')
    # one transaction paying several lines of one vendor
    for t in out:
        if t[0] in used:
            continue
        pool = [c for c in lines if not c['alloc'] and c['paid'] and -3 <= dd(c, t) <= 21 and ov(c, t) >= 2]
        if not 2 <= len(pool) <= 12:
            continue
        for n in range(2, min(6, len(pool)) + 1):
            hit = next((s for s in itertools.combinations(pool, n)
                        if round(sum(x['paid'] for x in s)) == round(t[4])), None)
            if hit:
                for x in hit:
                    x['alloc'] = [[t[0], None, 'one transaction pays %d lines' % n]]
                used.add(t[0])
                break
    # one line paid in several transactions
    for c in lines:
        if c['alloc'] or not c['paid']:
            continue
        pool = [t for t in out if t[0] not in used and -3 <= dd(c, t) <= 21 and ov(c, t) >= 3 and t[4] < c['paid']]
        for n in range(2, min(4, len(pool)) + 1):
            hit = next((s for s in itertools.combinations(pool, n)
                        if round(sum(t[4] for t in s)) == round(c['paid'])), None)
            if hit:
                c['alloc'] = [[t[0], t[4], 'paid in %d transactions' % n] for t in hit]
                used.update(t[0] for t in hit)
                break

    # amounts: the sheet's paid figure, never more than the transaction holds
    left = {t[0]: t[4] for t in ledger}
    for c in lines:
        for a in c['alloc']:
            want = a[1] if a[1] is not None else (c['paid'] if c['paid'] else by_no[a[0]][4])
            a[1] = round(min(want, left[a[0]]), 2)
            left[a[0]] -= a[1]
        c['alloc'] = [a for a in c['alloc'] if a[1] > 0]
        if not c['appr_at'] and c['alloc']:
            c['appr_at'] = min(by_no[a[0]][1] for a in c['alloc']) + ' 12:00'
            c['appr_how'] = 'paid date in the ledger (paid date = approval date)'
        if not c['appr_at']:
            c['appr_at'] = c['req_date'] + ' 12:00'
            c['appr_how'] = 'request date (no approval date and no ledger payment)'
    return by_no


def number_lines(lines, taken_docs):
    """Lines with a LINE ID keep it. The rest get one document per request date."""
    used = defaultdict(set)
    for c in lines:
        if c['line_id']:
            doc, n = c['line_id'].rsplit('-L', 1)
            c['doc_no'], c['line_no'] = doc, int(n)
            used[doc].add(int(n))
    new_doc = {}
    for c in lines:
        if c['line_id']:
            continue
        day = c['req_date']
        if day not in new_doc:
            stem = 'pr-' + day[2:4] + '-' + day[5:7] + '-' + day[8:10] + '_'
            k = 1
            while stem + '%02d' % k in taken_docs or stem + '%02d' % k in used:
                k += 1
            new_doc[day] = stem + '%02d' % k
            taken_docs.add(new_doc[day])
        c['doc_no'] = new_doc[day]
        c['line_no'] = max(used[c['doc_no']], default=0) + 1
        used[c['doc_no']].add(c['line_no'])
        c['line_id'] = '%s-L%02d' % (c['doc_no'], c['line_no'])


UNITS = {'PCS': 'pcs', 'DUS': 'carton', 'ROLL': 'roll', 'LITER': 'ltr', 'L': 'ltr', 'KG': 'kg',
         'GALON': 'gallon', 'SET': 'set', 'PACK': 'pack', 'BOX': 'box', 'BULAN': 'month',
         'MONTH': 'month', 'WEEK': 'week', 'ORANG': 'person', 'PAIL': 'pail', 'LEMBAR': 'lembar',
         'M': 'meter', 'METER': 'meter', 'RIM': 'ream', 'SAK': 'sak'}
CATS = {'FINISHING': 'FINISHING', 'FINNISHING': 'FINISHING', 'SANDING': 'SANDING', 'PACKING': 'PACKING'}
PEOPLE = {'PUTRI': 'putri@talaliving.com', 'DEWI': 'dewi@talaliving.com', 'EJO': 'evin@talaliving.com'}


def lit(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if v != int(v) else str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def main(xlsx, ledger_path):
    rows = read_rows(xlsx)
    lines = canonical(rows)
    ledger = json.load(open(ledger_path))
    by_no = match(lines, ledger)
    # legacy document numbers that exist in public.pr_documents and are not ours to reuse
    taken = {'pr-26-07-27_01', 'pr-26-08-03_01', 'pr-26-08-03_02', 'pr-26-08-04_01', 'pr-26-08-05_01',
             'pr-26-08-06_01', 'pr-26-08-06_02', 'pr-26-08-06_03', 'pr-26-08-06_04', 'pr-26-08-07_01',
             'pr-26-08-10_01', 'pr-26-08-11_01', 'pr-26-08-12_01', 'pr-26-08-13_01', 'pr-26-08-14_01',
             'pr-26-08-15_01', 'pr-26-08-18_01', 'pr-26-08-19_01', 'pr-26-08-20_01'}
    number_lines(lines, taken)

    L, A, S = [], [], []
    for c in lines:
        req = PEOPLE.get(str(c['req'] or '').strip().upper().split(',')[0].strip())
        unit_raw = str(c['unit'] or '').strip().upper()
        cat_raw = str(c['cat'] or '').strip().upper()
        total = c['idr'] if c['idr'] is not None else (
            c['qty'] * c['price'] if c['qty'] and c['price'] is not None else (c['paid'] or 0))
        notes = []
        if c['req'] and not req:
            notes.append('requested by %s, who has no account here — posted as shared@' % c['req'])
        if unit_raw and unit_raw not in UNITS:
            notes.append('unit %s is not one this system knows' % unit_raw)
        if cat_raw and cat_raw not in CATS:
            notes.append('category %s has no match in pr_category_t' % cat_raw)
        if c['project'] and str(c['project']).strip().upper() not in ('STANDARD', 'BABY ISLAND'):
            notes.append('project %s is not a project here' % str(c['project']).strip())
        if c['date_filled']:
            notes.append('the sheet row has no date; the row above it was used')
        if c['paid'] and not c['alloc']:
            notes.append('the sheet says Rp %s paid, and no ledger transaction was found for it'
                         % format(round(c['paid']), ',').replace(',', '.'))
        purpose = ' — '.join(str(x).strip() for x in (c['remark'], c['ket']) if x and str(x).strip())
        L.append('(' + ', '.join(lit(v) for v in (
            c['refs'][-1], ','.join(c['refs']), c['doc_no'], c['line_no'], c['req_date'],
            req, str(c['project']).strip().upper() if c['project'] else None,
            c['desc'], c['qty'] if c['qty'] and c['qty'] > 0 else None,
            UNITS.get(unit_raw), unit_raw or None, c['price'], max(total or 0, 0),
            c['vendor'], CATS.get(cat_raw), cat_raw or None, purpose or None,
            c['approved'], c['appr_at'], c['appr_how'], c.get('appr_by') or 'evin@talaliving.com', c['paid'],
            c['cancel_at'], c['cancel_by'], '; '.join(notes) or None)) + ')')
        for a in c['alloc']:
            A.append('(%s, %s, %s, %s)' % (lit(c['refs'][-1]), lit(a[0]), lit(a[1]), lit(a[2])))
        for r in c['refs'][:-1]:
            S.append('(%s, %s)' % (lit(r), lit(c['refs'][-1])))

    sys.stdout.write(open(__file__.replace('08_pr_sheet.py', '08_purchase_requests.head.sql')).read()
                     .replace('/*@LINES@*/', ',\n'.join(L))
                     .replace('/*@ALLOCS@*/', ',\n'.join(A))
                     .replace('/*@CARRIED@*/', ',\n'.join(S)))
    print('lines %d, allocations %d, carried copies %d, paid without ledger %d' % (
        len(L), len(A), len(S), sum(1 for c in lines if c['paid'] and not c['alloc'])), file=sys.stderr)


if __name__ == '__main__':
    main(*sys.argv[1:3])
