import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { llmConfig, generate, parseJsonObject } from "@/lib/llm";
import { NOTA_PROMPT, NOTA_SYSTEM, toNotaScan } from "@/lib/nota-vision";

/** `POST /api/inventory/nota/read` — a photographed nota, read by a model.
 *
 *  A server route for the same reason `/api/assistant/explain` is one: the
 *  model key cannot be in a browser. And like `readNota`, **it writes
 *  nothing** (D200): the answer is a `NotaScan` a person checks and then files
 *  through the ordinary seams, as themselves. The photo itself is filed as
 *  evidence by `/api/documents/upload` when they do — not here, because a
 *  reading somebody throws away should leave no file behind.
 *
 *  Asked of somebody who may record timber (`inventory.create`), not merely
 *  anybody signed in: every call is a paid request to a model.
 *
 *  Not `runtime = "edge"` — see the upload route for the deploy it cost.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

function refuse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, outcome: "refused", status },
      meta: { request_id: "", service: "inventory", version: "1", outcome: "refused" } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  const cfg = llmConfig();
  if (!cfg) {
    return refuse(501, "llm_not_configured",
      "Deployment ini belum punya model bahasa untuk membaca foto. IT mengisi ASSISTANT_LLM_PROVIDER dan "
      + "ASSISTANT_LLM_API_KEY di Worker. Sementara itu, tempel teks notanya.");
  }

  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Silakan masuk dulu.");

  const { data: may, error: mayErr } = await sb.schema("ops_core")
    .rpc("has_permission", { code: "inventory.create" });
  if (mayErr) return refuse(500, "database_error", mayErr.message);
  if (may !== true) return refuse(403, "forbidden", "Membaca nota kayu butuh izin mencatat inventory.");

  let form: FormData;
  try { form = await request.formData(); } catch { return refuse(400, "bad_request", "Kirim satu file nota."); }
  const file = form.get("file");
  if (!(file instanceof File)) return refuse(400, "file_required", "Tidak ada file yang terkirim.");
  if (!TYPES.includes(file.type)) {
    return refuse(415, "unsupported_type",
      `File ${file.type || "tanpa jenis"} tidak bisa dibaca. Kirim foto (JPG/PNG/WebP) atau PDF.`);
  }
  if (file.size > MAX_BYTES) {
    return refuse(413, "too_large", "File lebih dari 8 MB. Foto ulang dengan resolusi lebih kecil.");
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let text: string;
  try {
    text = await generate(cfg, {
      system: NOTA_SYSTEM,
      messages: [{ role: "user", text: NOTA_PROMPT, files: [{ mime: file.type, base64 }] }],
      json: true,
      maxTokens: 8000,
    });
  } catch (e) {
    return refuse(502, "llm_failed", `Model (${cfg.provider}) tidak menjawab: ${String((e as Error).message)}`);
  }

  const out = parseJsonObject(text);
  if (!out) {
    return refuse(502, "llm_unreadable",
      "Model menjawab, tapi jawabannya tidak bisa dibaca sebagai nota. Coba lagi, atau tempel teksnya.");
  }

  return Response.json({
    data: toNotaScan(out),
    meta: { request_id: "", service: "inventory", version: "1", outcome: "ok" },
  });
}
