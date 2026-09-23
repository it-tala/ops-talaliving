import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { llmConfig, generate, parseJsonObject, type LlmMessage } from "@/lib/llm";

/** `POST /api/assistant/explain` — John Lau answering *how do I…* with a model.
 *
 *  ## Why a server route, when the rest of John Lau is a client
 *
 *  The same reason `/api/documents/upload` exists: a secret. The model key
 *  cannot be in a browser, so the question makes one hop through the Worker.
 *  Nothing is *decided* here that the database decides elsewhere.
 *
 *  ## What the model is given, and what it is not
 *
 *  **Given:** the process knowledge (`ops_asst.processes`, `process_steps`,
 *  `process_faq` — written from walking the flows, 0124), the screen the person
 *  is on, and their own last few turns so a question asked on the PO screen can
 *  lean on one asked on the PR screen.
 *
 *  **Not given: any business data.** No balance, no vendor, no line. The model
 *  explains how the system is used; figures still come only from the keyword
 *  tools, which run the screen's own call as the person (D217, D219). That is
 *  what keeps D218 intact with a model in the loop — a model that has never
 *  seen a row cannot be talked into reciting one.
 *
 *  **Links are checked, not trusted.** Every `href` the model returns must be a
 *  route the knowledge itself names, or it is dropped. A model inventing
 *  `/procurement/approve-all` is a link to a 404 at best.
 *
 *  ## Recorded as the person
 *
 *  The turn goes through `ops_asst.record_turn` on the person's own session, so
 *  it lands under `auth.uid()` and only they can read it back (0039). That
 *  stored turn is also what makes the conversation survive a page change, a
 *  reload and a second tab: the dock reloads it, and the next question sends it
 *  back to the model as history.
 *
 *  ## Or it picks a tool (D300)
 *
 *  The same model may answer *which capability is this* instead of *how is it
 *  done*: `berapa hutang ke vendor`, `tolong siapkan PR untuk lem kayu`. It is
 *  shown the catalogue as this person sees it (`v_tool_catalogue`, with `may`)
 *  and may return one tool name with the arguments it read from the sentence.
 *  That pick is **returned, not run**: the client puts it through the gate
 *  and the same branches a keyword match takes, so a read is the screen's own
 *  call as the person and a write is a draft somebody confirms (D217–D220).
 *  The name must be in the catalogue and the arguments must be the keys that
 *  tool takes, or the pick is dropped and the answer is a guide instead.
 *  Blocked tools are shown too, so *berapa gaji Karjo* is refused with the
 *  sentence the owner wrote rather than answered with a guess (D218).
 *
 *  Not `runtime = "edge"` — see the upload route for the deploy it cost.
 */

interface ProcessRow {
  key: string; module: string; seq: number; title: string; purpose: string;
  route: string; permission: string | null; follows: string | null;
}
interface StepRow {
  process_key: string; seq: number; route: string | null; action: string; rule: string | null;
  status_before: string | null; status_after: string | null;
}
interface FaqRow { process_key: string; question: string; answer: string }
interface TurnRow { prompt: string; text: string; steps: { text: string }[] | null; at: string }

function refuse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, outcome: "refused", status },
      meta: { request_id: "", service: "procurement", version: "1", outcome: "refused" } },
    { status },
  );
}

const HISTORY = 12;

interface ToolRow {
  name: string; effect: "read" | "guide" | "write"; reach: "open" | "blocked";
  label_id: string; label_en: string; may: "blocked" | "no_grant" | "yes";
}

/** The arguments each write tool takes — the keys `draftShape` shows and the
 *  keyword router's `extract_args` fills. Anything else a model returns is
 *  dropped. Read tools take none: they answer the screen's own question. */
const TOOL_ARGS: Record<string, string[]> = {
  "procurement.draft_pr_line": ["name", "qty", "uom", "purpose"],
  "procurement.draft_po": ["name", "item", "qty", "uom", "unit_price"],
};

export async function POST(request: Request): Promise<Response> {
  const cfg = llmConfig();
  if (!cfg) {
    /* 501 is what the client listens for to fall back to *I do not
       understand*: a deployment without a model is John Lau as he was, not a
       broken one. */
    return refuse(501, "llm_not_configured",
      "This deployment has no language model. IT sets ASSISTANT_LLM_PROVIDER and ASSISTANT_LLM_API_KEY on the Worker.");
  }

  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Please sign in first.");

  let body: { prompt?: unknown; pathname?: unknown; lang?: unknown };
  try { body = await request.json(); } catch { return refuse(400, "bad_request", "Expected JSON."); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  const pathname = typeof body.pathname === "string" ? body.pathname.slice(0, 200) : "";
  const lang = body.lang === "en" ? "en" : "id";
  if (!prompt) return refuse(422, "empty_prompt", lang === "id" ? "Tulis pertanyaannya dulu." : "Write the question first.");

  const asst = sb.schema("ops_asst");
  const [procs, steps, faq, turns, cat] = await Promise.all([
    asst.from("processes").select("key,module,seq,title,purpose,route,permission,follows").order("seq"),
    asst.from("process_steps").select("process_key,seq,route,action,rule,status_before,status_after").order("process_key").order("seq"),
    asst.from("process_faq").select("process_key,question,answer"),
    asst.from("turns").select("prompt,text,steps,at").order("at", { ascending: false }).limit(HISTORY),
    asst.from("v_tool_catalogue").select("name,effect,reach,label_id,label_en,may").order("sort_order"),
  ]);
  const failed = procs.error ?? steps.error ?? faq.error ?? turns.error ?? cat.error;
  if (failed) return refuse(500, "database_error", failed.message);

  const processes = (procs.data ?? []) as ProcessRow[];
  const stepRows = (steps.data ?? []) as StepRow[];
  const faqRows = (faq.data ?? []) as FaqRow[];
  /* Only routes somebody can actually open: `/procurement/po/[po]` names a
     screen, not an address. */
  const knownRoutes = new Set<string>([
    ...processes.map((p) => p.route),
    ...stepRows.map((s) => s.route).filter((r): r is string => !!r),
  ].filter((r) => !r.includes("[")));

  /* Guides are answered from the knowledge above; the catalogue offers the
     rest — reads, writes (as drafts) and the closed ones, named as closed. */
  const tools = ((cat.data ?? []) as ToolRow[]).filter((t) => t.effect !== "guide");
  const system = systemPrompt(processes, stepRows, faqRows, pathname, lang, tools);

  /* Oldest first, and each past answer as the assistant's own words so the
     model reads a conversation rather than a log. */
  const history: LlmMessage[] = ((turns.data ?? []) as TurnRow[]).reverse().flatMap((t) => [
    { role: "user" as const, text: t.prompt },
    { role: "assistant" as const, text: [t.text, ...(t.steps ?? []).map((s, i) => `${i + 1}. ${s.text}`)].join("\n") },
  ]);

  let raw: string;
  try {
    raw = await generate(cfg, {
      system,
      messages: [...history, { role: "user", text: `[layar: ${pathname || "-"}] ${prompt}` }],
      json: true,
    });
  } catch (e) {
    return refuse(502, "llm_failed", `The model (${cfg.provider}) did not answer: ${String((e as Error).message)}`);
  }

  const parsed = parseJsonObject(raw);

  /* ── a tool, when the model picked one it is allowed to name ─────────── */
  const picked = typeof parsed?.tool === "string" ? tools.find((t) => t.name === parsed.tool) : undefined;
  if (picked) {
    const allowed = TOOL_ARGS[picked.name] ?? [];
    const rawArgs = (parsed?.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>;
    const args: Record<string, string> = {};
    for (const k of allowed) {
      const v = rawArgs[k];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) args[k] = String(v).trim().slice(0, 200);
    }
    const understood = typeof parsed?.understood === "string" && parsed.understood.trim()
      ? parsed.understood.trim().slice(0, 200)
      : (lang === "id" ? picked.label_id : picked.label_en);
    return Response.json({
      data: { pick: { tool: picked.name, args, understood, provider: cfg.provider } },
      meta: { request_id: "", service: "procurement", version: "1", outcome: "ok" },
    });
  }

  const text = typeof parsed?.text === "string" ? parsed.text.trim() : raw.trim();
  const cleanHref = (h: unknown): string | null =>
    typeof h === "string" && knownRoutes.has(h) ? h : null;
  const outSteps = Array.isArray(parsed?.steps)
    ? (parsed!.steps as unknown[]).slice(0, 12).flatMap((s) => {
        const o = s as { text?: unknown; href?: unknown; rule?: unknown };
        if (typeof o?.text !== "string" || !o.text.trim()) return [];
        return [{ text: o.text.trim(), href: cleanHref(o.href), rule: typeof o.rule === "string" && o.rule.trim() ? o.rule.trim() : null }];
      })
    : [];
  const usedKeys = Array.isArray(parsed?.processes)
    ? (parsed!.processes as unknown[]).filter((k): k is string => typeof k === "string" && processes.some((p) => p.key === k))
    : [];

  const { data: rec, error: recErr } = await asst.rpc("record_turn", {
    p_prompt: prompt,
    p_kind: "guide",
    p_lang: lang,
    p_understood_as: lang === "id" ? "pertanyaan cara pakai (AI)" : "how-to question (AI)",
    p_text: text || (lang === "id" ? "Maaf, saya belum bisa menjawab itu." : "Sorry, I cannot answer that yet."),
    p_facts: [],
    p_steps: outSteps,
    p_tools_used: [`ai.${cfg.provider}`, ...usedKeys.map((k) => `guide.${k}`)],
    p_refused_because: null,
    p_route: cleanHref(parsed?.route),
    p_matched_rule: null,
  });
  if (recErr) return refuse(500, "database_error", recErr.message);
  const env = rec as { outcome?: string; data?: unknown; error?: { code: string; message: string; status: number } };
  if (env.outcome !== "ok") {
    return refuse(env.error?.status ?? 422, env.error?.code ?? "refused", env.error?.message ?? "Refused.");
  }
  return Response.json({ data: env.data, meta: { request_id: "", service: "procurement", version: "1", outcome: "ok" } });
}

/** The instructions, and the whole of what the model knows about this
 *  business. Small enough to send every time — a few dozen processes — so
 *  there is no retrieval step to get wrong. */
function systemPrompt(
  processes: ProcessRow[], steps: StepRow[], faq: FaqRow[], pathname: string, lang: "en" | "id",
  tools: ToolRow[],
): string {
  const catalogue = tools.map((t) => {
    const state = t.reach === "blocked" ? "DITUTUP untuk prompt"
      : t.may === "yes" ? "boleh" : "pengguna ini belum punya izin";
    const args = TOOL_ARGS[t.name];
    return `- ${t.name} (${t.effect === "write" ? "menyiapkan draft" : "membaca data"}; ${state}): ${t.label_id}`
      + (args ? ` — args: ${args.join(", ")}` : "");
  }).join("\n");
  const kb = processes.map((p) => {
    const ss = steps.filter((s) => s.process_key === p.key).map((s) => {
      const st = s.status_before || s.status_after ? ` [status: ${s.status_before ?? "-"} → ${s.status_after ?? "-"}]` : "";
      return `  ${s.seq}. ${s.action}${s.route ? ` (layar ${s.route})` : ""}${st}${s.rule ? `\n     Aturan: ${s.rule}` : ""}`;
    }).join("\n");
    const qs = faq.filter((f) => f.process_key === p.key).map((f) => `  T: ${f.question}\n  J: ${f.answer}`).join("\n");
    return `### ${p.key} — ${p.title}\nModul: ${p.module}. Layar: ${p.route}.`
      + `${p.permission ? ` Izin: ${p.permission}.` : ""}${p.follows ? ` Sesudah: ${p.follows}.` : ""}\n`
      + `Tujuan: ${p.purpose}\nLangkah:\n${ss}${qs ? `\nTanya-jawab:\n${qs}` : ""}`;
  }).join("\n\n");

  return [
    "Kamu adalah John Lau, pemandu aplikasi internal Tala Living (manufaktur furnitur).",
    "Tugasmu ada dua: (a) menjelaskan CARA MEMAKAI sistem, langkah demi langkah; atau (b) memilih SATU alat dari KATALOG ALAT kalau pengguna meminta data atau meminta sesuatu disiapkan. Kamu sendiri tidak punya akses ke data bisnis — alat yang kamu pilih dijalankan oleh sistem atas nama pengguna, dan alat tulis hanya menyiapkan draft yang harus dikonfirmasi pengguna.",
    "",
    "Kapan memilih alat: pengguna bertanya angka/daftar yang dijawab alat baca (misalnya hutang ke vendor, saldo rekening, baris yang menunggu persetujuan), atau meminta dibuatkan/disiapkan sesuatu yang ada alat tulisnya (baris PR, PO). Pilih juga alat yang DITUTUP kalau itu yang diminta — sistem akan menolaknya dengan alasan resminya. Kalau tidak ada alat yang cocok, jawab sebagai panduan.",
    "Untuk alat tulis, isi `args` HANYA dengan yang benar-benar tertulis di kalimat pengguna. Jangan mengarang vendor, harga, atau jumlah; biarkan kosong, pengguna akan melengkapinya di draft.",
    "",
    "Aturan:",
    "1. Jawab HANYA dari PENGETAHUAN PROSES di bawah. Kalau jawabannya tidak ada di sana, katakan terus terang bahwa kamu belum tahu dan sarankan bertanya ke IT. Jangan menebak nama tombol, layar, atau aturan.",
    "2. Jangan pernah menyebut angka saldo, nominal, nama vendor, atau data transaksi. Kalau ditanya data (berapa, siapa, mana yang), katakan bahwa angka dibaca langsung di layarnya dan sebut layarnya.",
    "3. Jelaskan alasan di balik langkah (aturannya), bukan hanya tombolnya.",
    "4. Pengguna sedang berada di layar yang disebut di bawah. Kalau pertanyaannya menyambung percakapan sebelumnya, lanjutkan dari sana — misalnya tunjukkan langkah berikutnya yang terjadi di layar ini.",
    "5. `href` dan `route` hanya boleh diisi dengan alamat layar yang tertulis di pengetahuan. Selain itu isi null.",
    `6. Bahasa jawaban: ${lang === "id" ? "Bahasa Indonesia yang sederhana" : "plain English"}.`,
    "",
    "Balas HANYA dengan satu objek JSON, salah satu dari dua bentuk:",
    'Panduan: {"text": "jawaban singkat 1-3 kalimat", "steps": [{"text": "langkah", "href": "/alamat/layar atau null", "rule": "alasannya atau null"}], "route": "/layar utama atau null", "processes": ["kunci proses yang dipakai"]}',
    'Alat: {"tool": "nama.alat persis dari katalog", "args": {"kunci": "nilai"}, "understood": "apa yang kamu pahami dari permintaannya, satu kalimat"}',
    "`steps` boleh kosong kalau pertanyaannya bukan tentang cara melakukan sesuatu.",
    "",
    `Layar pengguna sekarang: ${pathname || "(tidak diketahui)"}`,
    "",
    "=== KATALOG ALAT ===",
    catalogue || "(kosong)",
    "",
    "=== PENGETAHUAN PROSES ===",
    kb || "(kosong)",
  ].join("\n");
}
