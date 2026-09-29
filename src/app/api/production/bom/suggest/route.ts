import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { llmConfig, generate, parseJsonObject } from "@/lib/llm";
import { driveConfigured, fetchDriveFile, fetchThumbnail } from "@/lib/drive";
import { driveFileId } from "@/lib/drive-links";
import { BOM_SYSTEM, bomPrompt, toBomSuggestion } from "@/lib/bom-vision";
import type { BomNorm, BomRate } from "@/services/production/contracts";

/** `POST /api/production/bom/suggest` — a product's gambar kerja, read by a
 *  model into a proposed BOM (D324).
 *
 *  A server route for the reason `/api/inventory/nota/read` is one: neither
 *  the model key nor the Drive key may be in a browser. And like the nota
 *  reader it **writes nothing** (D200). The answer is a `BomSuggestion`; the
 *  estimator keeps, changes or drops each line and adds the ones they keep
 *  through `save_bom_line`, as themselves.
 *
 *  Who may ask is the database's answer, read as the person: `production.update`
 *  (every call is a paid request to a model, and its only use is writing a
 *  BOM), the product and its drawing link through RLS, and the rate list and
 *  the business's estimating norms (0193, D338) the same way. Only then does
 *  the service account fetch the drawing from Drive.
 *
 *  Not `runtime = "edge"` — see the upload route for the deploy it cost.
 */

/* What each provider takes whole. A photo past the image limit goes as Drive's
   thumbnail instead, which is still sharp enough to read a dimension line. */
const IMAGE_MAX = Math.floor(4.5 * 1024 * 1024);
const PDF_MAX = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function refuse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, outcome: "refused", status },
      meta: { request_id: "", service: "production", version: "1", outcome: "refused" } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  const cfg = llmConfig();
  if (!cfg) {
    return refuse(501, "llm_not_configured",
      "Deployment ini belum punya model bahasa untuk membaca gambar kerja. IT mengisi ASSISTANT_LLM_PROVIDER dan "
      + "ASSISTANT_LLM_API_KEY di Worker. Sementara itu, komponennya diisi sendiri dengan + Tambah komponen.");
  }
  if (!driveConfigured()) {
    return refuse(501, "drive_not_configured",
      "Gambar kerja disimpan di Google Drive, dan akun layanan Drive belum dipasang di deployment ini.");
  }

  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Silakan masuk dulu.");

  const { data: may, error: mayErr } = await sb.schema("ops_core")
    .rpc("has_permission", { code: "production.update" });
  if (mayErr) return refuse(500, "database_error", mayErr.message);
  if (may !== true) return refuse(403, "forbidden", "Usulan BOM dari AI butuh izin mengubah BOM (produksi, update).");

  let body: { product_code?: unknown; attachment_id?: unknown };
  try { body = await request.json(); } catch { return refuse(400, "bad_request", "Kirim product_code."); }
  const code = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
  const wanted = typeof body.attachment_id === "string" && body.attachment_id ? body.attachment_id : null;
  if (!code) return refuse(400, "product_required", "Produk yang mana?");

  const { data: product, error: pErr } = await sb.schema("ops_prod").from("v_product_summary")
    .select("product_code, name, category, uom, length_mm, width_mm, height_mm, description")
    .eq("product_code", code).maybeSingle();
  if (pErr) return refuse(500, "database_error", pErr.message);
  if (!product) return refuse(404, "product_not_found", `Tidak ada produk ${code}.`);

  /* The newest gambar kerja, or the revision the person is looking at. */
  const { data: links, error: lErr } = await sb.schema("ops_core").from("v_attachment_link")
    .select("attachment_id, linked_at")
    .eq("entity", "product").eq("entity_no", code).eq("kind", "Gambar Kerja")
    .order("linked_at", { ascending: false });
  if (lErr) return refuse(500, "database_error", lErr.message);
  const link = (links ?? []).find((l) => !wanted || l.attachment_id === wanted);
  if (!link) {
    return refuse(422, "no_drawing", "Belum ada gambar kerja untuk dibaca. Unggah gambar kerjanya dulu.");
  }
  const { data: att, error: aErr } = await sb.schema("ops_core").from("v_attachment")
    .select("id, filename, mime, storage_path, url, web_view_link")
    .eq("id", link.attachment_id).maybeSingle();
  if (aErr) return refuse(500, "database_error", aErr.message);
  if (!att) return refuse(404, "drawing_not_found", "Berkas gambar kerja itu tidak bisa dibaca dengan akses Anda.");

  const fileId = driveFileId(att as { storage_path: string | null; url: string | null; web_view_link: string | null });
  if (!fileId) {
    return refuse(422, "not_on_drive",
      "Gambar kerja ini link di luar Google Drive, jadi aplikasi tidak bisa membacanya. Unggah berkasnya (foto atau PDF).");
  }

  let file: Awaited<ReturnType<typeof fetchDriveFile>>;
  try {
    file = await fetchDriveFile(fileId, PDF_MAX);
  } catch (e) {
    return refuse(502, "drive_failed", `Google Drive tidak memberikan berkasnya: ${String((e as Error).message)}`);
  }
  if (!file) {
    return refuse(404, "drive_unreachable",
      "Berkas gambar kerja tidak terjangkau akun layanan di Google Drive. IT memeriksa akses drive-nya di IT → Google Drive.");
  }

  let mime = file.mime;
  let bytes = file.bytes;
  if (IMAGE_TYPES.includes(mime)) {
    if (!bytes || bytes.byteLength > IMAGE_MAX) {
      const thumb = await fetchThumbnail(fileId, 2000).catch(() => null);
      if (!thumb) return refuse(413, "too_large", "Foto gambar kerja terlalu besar untuk dibaca. Unggah versi yang lebih kecil atau PDF.");
      bytes = await thumb.arrayBuffer();
      mime = thumb.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      if (bytes.byteLength > IMAGE_MAX) {
        return refuse(413, "too_large", "Foto gambar kerja terlalu besar untuk dibaca. Unggah versi yang lebih kecil atau PDF.");
      }
    }
  } else if (mime === "application/pdf") {
    if (!bytes) return refuse(413, "too_large", "PDF gambar kerja lebih dari 20 MB. Unggah hanya halaman yang dipakai.");
  } else {
    return refuse(415, "unsupported_type",
      `Gambar kerja berjenis ${mime} tidak bisa dibaca model. Unggah sebagai foto (JPG/PNG) atau PDF.`);
  }

  const { data: rateRows, error: rErr } = await sb.schema("ops_prod").from("bom_rates")
    .select("*").eq("active", true).order("rate_group").order("name");
  if (rErr) return refuse(500, "database_error", rErr.message);
  /* `unit_rate` in the table (0182); `rate` in the contract. */
  const rates: BomRate[] = ((rateRows ?? []) as (Omit<BomRate, "rate"> & { unit_rate: number | string })[])
    .map(({ unit_rate, ...r }) => ({ ...r, rate: Number(unit_rate) }));

  /* The norms in force, as the person reads them (`production.read`, 0193).
     The model is told to take waste, yield and coverage from these, and
     `toBomSuggestion` holds each line's waste to the norm it names. */
  const { data: normRows, error: nErr } = await sb.schema("ops_prod").from("v_bom_norm")
    .select("*").order("category").order("norm");
  if (nErr) return refuse(500, "database_error", nErr.message);
  const norms: BomNorm[] = ((normRows ?? []) as (Omit<BomNorm, "value"> & { value: number | string | null })[])
    .map((n) => ({ ...n, value: n.value == null ? null : Number(n.value) }));

  let text: string;
  try {
    text = await generate(cfg, {
      system: BOM_SYSTEM,
      messages: [{
        role: "user",
        text: bomPrompt(product, rates, norms),
        files: [{ mime, base64: Buffer.from(bytes).toString("base64") }],
      }],
      json: true,
      maxTokens: 8000,
    });
  } catch (e) {
    return refuse(502, "llm_failed", `Model (${cfg.provider}) tidak menjawab: ${String((e as Error).message)}`);
  }

  const out = parseJsonObject(text);
  if (!out) {
    return refuse(502, "llm_unreadable",
      "Model menjawab, tapi jawabannya tidak bisa dibaca sebagai BOM. Coba lagi, atau isi komponennya sendiri.");
  }

  return Response.json({
    data: toBomSuggestion(out, rates, {
      product_code: code,
      drawing: { attachment_id: att.id as string, filename: att.filename as string },
    }, norms),
    meta: { request_id: "", service: "production", version: "1", outcome: "ok" },
  });
}
