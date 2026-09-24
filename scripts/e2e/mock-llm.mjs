#!/usr/bin/env node
/** A stand-in language model for walking John Lau without a key.
 *
 *  Speaks the OpenAI-compatible `/chat/completions` shape `src/lib/llm.ts`
 *  already supports (`ASSISTANT_LLM_PROVIDER=openai`, `ASSISTANT_LLM_BASE_URL`
 *  pointing here), and answers from a fixed table keyed on the last user
 *  message. It proves the plumbing — the catalogue reaches the model, a pick
 *  goes through the gate, a draft is a draft, a closed tool is refused — and
 *  says nothing about how good a real model's reading is. That is measured
 *  with a real key, on real sentences.
 *
 *    node scripts/e2e/mock-llm.mjs            # listens on 54340
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 54340);
const RULES = [
  [/hutang|utang|lunasi/i, { tool: "procurement.vendor_debt", args: {}, understood: "hutang ke vendor" }],
  [/gaji|dibayar/i, { tool: "hr.payroll", args: {}, understood: "gaji seseorang" }],
  [/(siapkan|buatkan).*(pr|permintaan)/i, { tool: "procurement.draft_pr_line",
    args: { name: "KSA binder", qty: "5", uom: "ltr", invented_vendor: "PT Karangan" },
    understood: "baris permintaan untuk KSA binder 5 liter" }],
  /* A leave request in words the router does not know. The model names the
     person and the kind; its date is in the wrong shape and one field is
     invented, and both must be dropped (D301). */
  [/libur/i, { tool: "hr.draft_leave",
    args: { employee: "Wulan", kind: "cuti", from: "minggu depan", reason: "menikah", invented_salary: "4500000" },
    understood: "cuti untuk Wulan" }],
  [/pesankan/i, { tool: "procurement.draft_po",
    args: { item: "engsel", unit_price: "1", vendor: "PT Karangan" },
    understood: "PO untuk engsel" }],
  [/.*/, { text: "Buka Procurement → Purchase Orders lalu tekan \"Add new PO\".", steps: [
    { text: "Buka Purchase Orders", href: "/procurement/po", rule: null },
    { text: "Buka halaman karangan", href: "/tidak/ada", rule: null }],
    route: "/procurement/po", processes: ["procure.create_po"] }],
];

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msgs = JSON.parse(body || "{}").messages ?? [];
    const system = msgs.find((m) => m.role === "system")?.content ?? "";
    const last = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    const hit = RULES.find(([re]) => re.test(last))[1];
    const out = { ...hit, _saw_catalogue: system.includes("=== KATALOG ALAT ===") };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
}).listen(PORT, () => console.log(`mock model on http://127.0.0.1:${PORT}`));
