import "server-only";

/* Types only. The contracts module also carries the screens' bilingual labels,
   and those import a React hook a server route cannot compile. */
import type { BomNorm, BomRate, BomSuggestion, BomSuggestionLine } from "@/services/production/contracts";
import { findNorm, normLabel, normPromptLine, wasteFromNorm } from "@/lib/bom-norms";

/** Reading a gambar kerja with a language model, into a BOM somebody checks
 *  (D324).
 *
 *  The owner's brief: *setelah user tambah produk otomatis dia ke halaman BOM,
 *  lalu dari gambar kerja yang di-upload langsung dibaca oleh AI, lalu
 *  melakukan estimasi kebutuhan tiap komponen dan ambil rate dari database,
 *  jadi user tinggal evaluasi, menambahkan atau mengubah komponen.*
 *
 *  Three rules make that safe to put in front of a costing, and each is the
 *  same rule the nota reader follows (D200):
 *
 *  - **The model proposes; nothing is written.** The answer is a
 *    `BomSuggestion` the estimator edits, and a line reaches the BOM only when
 *    a person adds it through `save_bom_line`, as themselves.
 *  - **The price is never the model's.** It is shown the rate list without
 *    figures and asked which entry fits; the figure is read from the list here.
 *    A code it invents is dropped to *unmatched*, not trusted.
 *  - **The waste is the business's, not the model's** (0193, D338). It is
 *    shown the norms in force and asked which one a line's waste comes from;
 *    the figure is then read from that norm here, exactly as the price is read
 *    from the rate list. A waste no norm backs stays, with a warning.
 *  - **A doubt is shown, not smoothed over.** A unit that differs from the
 *    rate's, a quantity no product could need, text it could not read — each
 *    stays on the line as a warning for the person checking it.
 */

export const BOM_SYSTEM = `Kamu estimator di bengkel mebel kayu di Indonesia. Kamu membaca GAMBAR KERJA satu produk dan menyusun usulan BOM (bill of material) untuk SATU unit produk.
Jawab HANYA dengan satu objek JSON, tanpa teks lain, dengan bentuk:

{
  "summary": string,
  "lines": [
    {
      "part": string,
      "kind": "material" | "labour",
      "rate_code": string | null,
      "material": string,
      "qty": number,
      "uom": string,
      "waste_percent": number,
      "waste_norm": string | null,
      "working": string,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "assumptions": [string],
  "unread": [string]
}

Aturan:
- "part" = nama komponen/bagian produk dalam bahasa Indonesia, seperti di gambar: "Kaki-kaki", "Top", "Rangka (apron)", "Laci", "Pintu", "Panel belakang".
- Satu baris = satu material untuk satu bagian. Potongan yang sama digabung (4 kaki = 1 baris "Kaki-kaki" dengan qty total).
- Selain bagian kayu/panel, tambahkan baris untuk hardware/pengikat, finishing, tenaga kerja (kind "labour") dan packing bila DAFTAR RATE punya kelompoknya.
- "rate_code": kode dari DAFTAR RATE yang paling cocok — jenis kayu DAN grade harus cocok. Tidak ada yang cocok: null, dan tulis materialnya di "material".
- "material": nama material yang kamu maksud, mis. "Kayu mindi grade A".
- "qty": kebutuhan BERSIH untuk satu unit, dalam SATUAN RATE yang dipilih ("uom" = satuan rate itu).
  Kayu solid dalam m3: jumlah potong × panjang × lebar × tebal (mm) ÷ 1.000.000.000.
  Plywood/panel: lembar (1220 × 2440 mm) atau m2, sesuai satuan rate.
  Finishing: m2 luas permukaan yang difinishing. Tenaga kerja: hari (atau satuan rate). Packing: sesuai satuan rate.
- "waste_percent" dan "waste_norm": ikuti ATURAN SUSUT di pesan.
- "working": cara menghitung, singkat, mis. "4 × 50×50×720 mm = 0,0072 m3".
- Ukuran dibaca dari gambar. Yang tidak tertulis: pakai ukuran produk yang diberikan dan tulis asumsinya di "assumptions".
- Angka atau tulisan yang tidak yakin terbaca masuk "unread". Jangan ditebak diam-diam.
- JANGAN menulis harga apa pun. Harga diambil sistem dari daftar rate.
- Paling banyak 40 baris.`;

export function bomPrompt(
  product: {
    product_code: string; name: string; category: string; uom: string;
    length_mm: number | null; width_mm: number | null; height_mm: number | null;
    description: string | null;
  },
  rates: BomRate[],
  norms: BomNorm[] = [],
): string {
  const size = [product.length_mm, product.width_mm, product.height_mm].every((n) => n != null)
    ? `${product.length_mm} × ${product.width_mm} × ${product.height_mm} mm (P × L × T)`
    : "belum diisi — baca dari gambar";
  const list = rates.length
    ? rates.map((r) => `${r.code} | ${r.name} | ${r.rate_group} | per ${r.uom}`).join("\n")
    : "(kosong — semua rate_code null)";
  return [
    `PRODUK: ${product.name} (${product.product_code}), kategori ${product.category}, satuan ${product.uom}.`,
    `UKURAN: ${size}.`,
    product.description ? `KETERANGAN: ${product.description}` : null,
    "",
    "DAFTAR RATE (kode | nama | kelompok | satuan):",
    list,
    "",
    ...(norms.length ? [
      "NORMA ESTIMASI BISNIS (kategori | norma | nilai | sumber | dasar — catatan):",
      ...norms.map(normPromptLine),
      "",
      "ATURAN SUSUT dan norma:",
      "- Susut, rendemen, cakupan finishing, ukuran lembar standar, lebar kain dan sejenisnya DIAMBIL DARI NORMA di atas, bukan dari perkiraanmu sendiri. Sebut norma yang dipakai untuk menghitung qty di \"working\".",
      "- \"waste_norm\": norma yang menjadi dasar susut baris itu, ditulis persis \"kategori | norma\". Norma susut (%) → waste_percent = nilainya. Norma rendemen/yield (%) → waste_percent = (100 ÷ yield − 1) × 100.",
      "- Tidak ada norma yang berlaku untuk susut baris itu: \"waste_norm\" null dan \"waste_percent\" 0.",
      "- Overhead, kontingensi/miskalkulasi dan MISC berlaku untuk seluruh BOM, bukan untuk satu baris: jangan dijadikan baris dan jangan dijadikan susut. Norma susut di kategori Factor (mis. waste kayu, waste material lain) tetap susut baris.",
      "- Ikuti catatan tiap norma tentang cara memakainya (mis. norma yang hanya untuk mengubah harga, bukan kebutuhan).",
      "- Dua norma bertentangan: pakai yang sumbernya decision, lalu empirical, lalu industry.",
      "",
    ] : [
      "ATURAN SUSUT: bisnis belum punya norma tertulis. \"waste_norm\" null; \"waste_percent\" susut yang wajar — kayu solid 10–20, panel 5–15, selain itu 0.",
      "",
    ]),
    "Baca gambar kerja ini dan susun BOM untuk satu unit.",
  ].filter((x) => x !== null).join("\n");
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** `m³`, `M3`, ` m 3 ` → `m3`, so a unit can be compared with the rate's. */
function unitKey(u: string): string {
  return u.toLowerCase().replace(/³/g, "3").replace(/²/g, "2").replace(/\s+/g, "");
}

/** Past this, a quantity per unit is a misreading, not a big table. */
const IMPLAUSIBLE: Record<string, number> = { m3: 3, m2: 60, lembar: 40, hari: 60, jam: 480 };

/** The model's object, as a suggestion a person can check. */
export function toBomSuggestion(
  out: Record<string, unknown>,
  rates: BomRate[],
  base: { product_code: string; drawing: BomSuggestion["drawing"] },
  norms: BomNorm[] = [],
): BomSuggestion {
  const byCode = new Map(rates.map((r) => [r.code.toUpperCase(), r]));
  const unread = (Array.isArray(out.unread) ? out.unread : [])
    .map((x) => str(x)).filter((x): x is string => x !== null).slice(0, 30);
  const assumptions = (Array.isArray(out.assumptions) ? out.assumptions : [])
    .map((x) => str(x, 300)).filter((x): x is string => x !== null).slice(0, 15);

  const lines: BomSuggestionLine[] = [];
  for (const raw of Array.isArray(out.lines) ? out.lines.slice(0, 60) : []) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const part = str(l.part, 80) ?? "Komponen";
    const material = str(l.material, 120);
    const qty = num(l.qty);
    if (qty == null || qty <= 0 || qty > 100_000) {
      unread.push(`${part}${material ? ` · ${material}` : ""}: jumlahnya tidak terbaca (${String(l.qty ?? "—")})`);
      continue;
    }
    const warnings: string[] = [];
    const asked = str(l.rate_code, 20)?.toUpperCase() ?? null;
    const rate = asked ? byCode.get(asked) ?? null : null;
    if (asked && !rate) warnings.push(`Model menyebut ${asked}, yang tidak ada di daftar rate — pilih rate-nya.`);

    const modelUom = str(l.uom, 20);
    let uom = modelUom ?? "pcs";
    let confidence: BomSuggestionLine["confidence"] =
      l.confidence === "high" || l.confidence === "low" ? l.confidence : "medium";
    if (rate) {
      if (modelUom && unitKey(modelUom) !== unitKey(rate.uom)) {
        warnings.push(`Model menghitung dalam ${modelUom}, rate-nya per ${rate.uom} — periksa jumlahnya.`);
        confidence = "low";
      }
      uom = rate.uom;
    }
    const ceiling = IMPLAUSIBLE[unitKey(uom)];
    if (ceiling != null && qty > ceiling) {
      warnings.push(`${qty} ${uom} untuk satu unit tidak biasa — kemungkinan salah baca.`);
      confidence = "low";
    }

    /* The waste the named norm gives, not the one the model wrote beside it. */
    let waste = num(l.waste_percent);
    if (waste != null && (waste < 0 || waste > 90)) waste = null;
    const askedNorm = str(l.waste_norm, 160);
    const norm = findNorm(norms, askedNorm);
    const normWaste = norm ? wasteFromNorm(norm) : null;
    let wasteNorm: string | null = null;
    if (norm && normWaste != null) {
      waste = normWaste;
      wasteNorm = normLabel(norm);
    } else if (norms.length > 0 && (waste ?? 0) > 0) {
      warnings.push(askedNorm && !norm
        ? `Model menyebut norma "${askedNorm}", yang tidak ada — susut ${waste}% perlu diperiksa.`
        : `Susut ${waste}% adalah perkiraan model, bukan dari norma bisnis — periksa.`);
    }
    lines.push({
      part,
      /* A labour rate is a labour line, whatever the model called it
         (`rateLineKind` in the contracts, restated for the reason above). */
      kind: rate ? (rate.rate_group === "labour" ? "labour" : "material") : l.kind === "labour" ? "labour" : "material",
      rate_code: rate?.code ?? null,
      material: material ?? rate?.name ?? "—",
      qty: Math.round(qty * 10_000) / 10_000,
      uom,
      waste_percent: waste != null ? Math.round(waste * 10) / 10 : 0,
      waste_norm: wasteNorm,
      rate: rate?.rate ?? null,
      working: str(l.working, 240),
      confidence,
      warnings,
    });
  }

  /* One material for one part is one line on a BOM (0182's unique index), so
     two proposals for the same pair are added together here rather than
     refused one at a time when the estimator presses *Add*. */
  const merged: BomSuggestionLine[] = [];
  for (const l of lines) {
    const key = (x: BomSuggestionLine) =>
      `${x.part.toLowerCase()}|${x.rate_code ?? x.material.toLowerCase()}|${x.kind}`;
    const twin = merged.find((m) => key(m) === key(l) && unitKey(m.uom) === unitKey(l.uom));
    if (twin) {
      twin.qty = Math.round((twin.qty + l.qty) * 10_000) / 10_000;
      twin.working = [twin.working, l.working].filter(Boolean).join("; ") || null;
      twin.warnings = [...new Set([...twin.warnings, ...l.warnings])];
    } else {
      merged.push({ ...l });
    }
  }

  return {
    product_code: base.product_code,
    drawing: base.drawing,
    source: "model",
    summary: str(out.summary, 400),
    lines: merged,
    assumptions,
    unread,
    norms: norms.length,
  };
}
