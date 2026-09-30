#!/usr/bin/env python3
"""Check a weekly payroll workbook against itself, before it is compared with ops.

    python3 scripts/hr/payroll-sheet/audit.py WEEK.xlsx

`reconcile.py` asks *does ops pay what the sheet paid?* This asks the question
before it: *does the sheet pay what its own columns say?* Every row of the
payroll tab is recomputed from its inputs —

    O  = SENIN..JUMAT (+ SABTU for guards and the helper)
    P  = O × M                       upah
    S  = (SENIN..JUMAT) × Q          insentif
    V  = U × M/8 × 1,5               lembur 1,5×
    Y  = X × M/8 × 2                 lembur 2×
    AB = AA × M × 2                  Sabtu/Minggu/tanggal merah
    AD = O × AC                      tunjangan
    AG = P + S + V + Y + AB + AD + AF − AE

— and every figure that was **typed rather than computed** is listed, because
that is where a sheet and a machine can disagree without anybody noticing
(F197). The machine's export in the same workbook is then read the way the
sheet's own timesheet reads it, per person per day, to show where the paid
days differ from the days the machine saw.
"""
import datetime as dt, sys
import openpyxl

def col(c):
    n = 0
    for ch in c: n = n * 26 + ord(ch) - 64
    return n - 1

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return 0.0

def main(path):
    vals = openpyxl.load_workbook(path, data_only=True, read_only=True)
    forms = openpyxl.load_workbook(path, data_only=False, read_only=True)
    name = next(n for n in vals.sheetnames if n.upper().startswith("ADJUSTED OLD FORMAT"))
    rows = [list(r) for r in vals[name].iter_rows(values_only=True)]
    frows = [list(r) for r in forms[name].iter_rows(values_only=True)]
    hdr = next(i for i, r in enumerate(rows) if len(r) > 11 and isinstance(r[col('F')], dt.datetime)
               and isinstance(r[col('L')], dt.datetime))
    days = [rows[hdr][col(c)].date() for c in "FGHIJKL"]
    print(f"{path.split('/')[-1]} · tab {name!r} · {days[0]} – {days[-1]} · AG total {num(rows[hdr][col('AG')]):,.2f}")
    print("tabs:", ", ".join(vals.sheetnames))

    issues, typed = [], {}
    total = 0.0
    for i, r in enumerate(rows[hdr + 1:], start=hdr + 2):
        if len(r) <= col('AG') or not r[col('D')] or not isinstance(r[col('B')], (int, float)): continue
        f = frows[i - 1] if i - 1 < len(frows) else []
        g = lambda c: num(r[col(c)])
        nm = str(r[col('D')]).strip()
        div = str(r[col('E')] or '').upper()
        sat = 'SECURITY' in div or 'HELPER' in div
        m = g('M')
        wk = sum(g(c) for c in "HIJKL")
        o_exp = wk + (g('F') if sat else 0)
        checks = [
            ("O hari", g('O'), o_exp),
            ("P upah", g('P'), g('O') * m),
            ("S insentif", g('S'), g('R') * g('Q') if g('R') else wk * g('Q')),
            ("V lembur 1,5×", g('V'), g('U') * m / 8 * 1.5),
            ("Y lembur 2×", g('Y'), g('X') * m / 8 * 2),
            ("AB akhir pekan", g('AB'), g('AA') * m * 2),
            ("AD tunjangan", g('AD'), g('O') * g('AC')),
            ("AG total", g('AG'), g('P') + g('S') + g('V') + g('Y') + g('AB') + g('AD') + g('AF') - g('AE')),
        ]
        for label, got, want in checks:
            if abs(got - want) >= 1:
                issues.append(f"  {nm:<12} {label}: tertulis {got:,.2f}, dari kolomnya {want:,.2f} (selisih {got - want:+,.2f})")
        for c in ("O", "U", "X", "AA", "AE", "AF"):
            cell = f[col(c)] if col(c) < len(f) else None
            if cell not in (None, "", 0) and not (isinstance(cell, str) and cell.startswith("=")):
                typed.setdefault(c, []).append(f"{nm} {cell}")
            elif isinstance(cell, str) and cell.startswith("=") and c in ("AE", "AF"):
                typed.setdefault(c, []).append(f"{nm} {cell}")
        total += g('AG')
    print(f"baris orang: jumlah AG {total:,.2f}")
    print("hitungan yang tidak sesuai kolomnya sendiri:" if issues else "hitungan: setiap baris sesuai kolomnya sendiri")
    for x in issues: print(x)
    labels = {"O": "hari", "U": "jam lembur 1,5×", "X": "jam lembur 2×", "AA": "hari Sabtu/Minggu/merah",
              "AE": "potongan", "AF": "saldo"}
    for c, xs in typed.items():
        print(f"diketik, bukan rumus — {c} ({labels[c]}): " + "; ".join(xs))

    bio = next((vals[n] for n in vals.sheetnames if n.upper().startswith("PASTE HERE BIOMETRIC")), None)
    if bio is None:
        print("tidak ada tab PASTE HERE BIOMETRIC"); return
    seen = {}
    for r in bio.iter_rows(values_only=True):
        if len(r) > 3 and isinstance(r[2], (int, float)) and isinstance(r[3], dt.datetime):
            seen.setdefault((int(r[2]), str(r[1]).strip()), set()).add(r[3].date())
    per_day = {}
    for (_, _), ds in seen.items():
        for d in ds: per_day[d] = per_day.get(d, 0) + 1
    print("orang bertap per hari:", ", ".join(f"{d:%a %d/%m} {per_day.get(d, 0)}" for d in days))

if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p); print()
