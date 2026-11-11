#!/usr/bin/env python3
"""13_pr_sheet.py — the recap rows step 11 never saw, read into SQL.

    python3 supabase/import/13_pr_sheet.py > supabase/import/13_pr_recap_sep_okt.sql

Step 11 (`08_pr_sheet.py`, applied 2026-09-23) read AUGUST, APROVE 27-08 and
SEPTEMBER up to row 102. Since then the office added sixteen rows to
SEPTEMBER, kept a whole OKTOBER tab, and paid the lines step 11 left APPROVED.
This script writes those, with the same rules:

- **paid on the day it was approved** (owner, again on 2026-11-11: *kamu boleh
  berasumsi bahwa tanggal approve adalah tanggal dibayar*). The GOODS
  approval is dated by the first ledger transaction that paid the line;
- **no ledger transaction is created or changed**. Where the sheet and the
  ledger disagree on an amount, the allocation is the smaller of the two;
- **no reference is invented**: a vendor, project, unit or category that does
  not resolve lands null, the sheet's text kept in the map note;
- idempotent through `ops_core.legacy_map` (`sheet.pr_recap`, refs `SEP103`…,
  `OKT7`…), so a second run stages nothing.

The data — the sheet rows, which of them the web app already holds, and which
transaction paid each — lives in `13_pr_rows.py`, read by hand against the
ledger. This file only turns it into SQL.

Fourteen OKTOBER rows were already typed into the web app as one-line PRs
(`WEB`). They get no second line: the sheet's approval (where the web line
was still waiting) and its payment land on the line that exists.
"""
import importlib
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
data = importlib.import_module('13_pr_rows')

UNITS = {'PCS': 'pcs', 'DUS': 'carton', 'ROLL': 'roll', 'LITER': 'ltr', 'KG': 'kg', 'SET': 'set',
         'PACK': 'pack', 'BOX': 'box', 'BULAN': 'month', 'MONTH': 'month', 'MONTHLY': 'month',
         'WEEK': 'week', 'LEMBAR': 'lembar', 'METER': 'meter', 'RIM': 'ream', 'SAK': 'sak'}
CATS = {'FINISHING': 'FINISHING', 'SANDING': 'SANDING', 'PACKING': 'PACKING'}
PEOPLE = {'PUTRI': 'putri@talaliving.com', 'DEWI': 'dewi@talaliving.com'}


def lit(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if v != int(v) else str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def main():
    allocs = defaultdict(list)
    for ref, trx, amount, how in data.ALLOC:
        allocs[ref].append((trx, amount, how))

    R, A = [], []
    for (ref, day, req, project, cat, desc, note, vendor, qty, unit, price, idr, paid) in data.ROWS:
        unit_raw = (unit or '').strip().upper()
        cat_raw = (cat or '').strip().upper()
        notes = []
        if unit_raw and unit_raw not in UNITS:
            notes.append('unit %s is not one this system knows' % unit_raw)
        if cat_raw and cat_raw not in CATS:
            notes.append('category %s has no match in pr_category_t' % cat_raw)
        got = sum(a for _, a, _ in allocs[ref])
        if paid and got < paid:
            notes.append('the sheet says Rp %s paid; the ledger holds Rp %s for it'
                         % (format(round(paid), ',').replace(',', '.'), format(round(got), ',').replace(',', '.')))
        R.append('(' + ', '.join(lit(v) for v in (
            ref, data.WEB.get(ref), day, PEOPLE.get((req or '').upper()), (project or '').strip().upper() or None,
            desc, qty, UNITS.get(unit_raw), price, idr, vendor, CATS.get(cat_raw), note, paid,
            '; '.join(notes) or None)) + ')')
    for ref, trx, amount, how in data.ALLOC:
        A.append('(%s, %s, %s, %s)' % (lit(ref), lit(trx), lit(amount), lit(how)))

    head = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '13_pr_recap_sep_okt.head.sql')).read()
    sys.stdout.write(head.replace('/*@ROWS@*/', ',\n'.join(R)).replace('/*@ALLOCS@*/', ',\n'.join(A)))
    print('rows %d (%d already in the web app), allocations %d' % (len(R), len(data.WEB), len(A)), file=sys.stderr)


if __name__ == '__main__':
    main()
