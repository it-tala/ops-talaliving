"use client";

import { stripRefs } from "@/lib/refs";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  MessageSquare, X, Send, ShieldAlert, KeyRound, ArrowUpRight, Check, Wrench, BookOpen, Sparkles, MapPin,
} from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { assistant } from "@/demo/api";
import type { AssistantTurn } from "@/services/assistant/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useT, useLang } from "@/lib/i18n";
import { formatIDR } from "@/lib/format";
import { isRouteLive } from "@/lib/live";
import { MESSAGES, EXAMPLES } from "@/lib/messages";

/** John Lau, docked.
 *
 *  It lives in the shell rather than on a page, and that is the requirement
 *  rather than a decoration: *ask how to make a PO, then go to the PO screen
 *  and keep reading the steps*. A chat that lives on its own page cannot do
 *  that — you leave it to do the thing it told you to do (D223).
 *
 *  So navigation happens **under** the panel. The conversation is untouched by
 *  the route change, the steps stay on screen beside the form they describe,
 *  and nothing has to be repeated.
 *
 *  **A reload is not allowed to forget either** (D296). The conversation is
 *  already stored — every turn is a row in `ops_asst.turns` — so the dock reads
 *  it back when it mounts, and a refresh, a second tab or tomorrow morning
 *  opens where the person left off. Whether the panel was open is a
 *  convenience of this tab and lives in `sessionStorage`, guarded, because a
 *  browser that refuses storage must still get a working dock.
 */
const OPEN_KEY = "john-lau.open";

export function JohnLauDock() {
  const [open, setOpenState] = useState(false);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname();
  const bottom = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const { ready } = useSession();
  const t = useT();
  const router = useRouter();

  function setOpen(v: boolean) {
    setOpenState(v);
    try { sessionStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* storage refused */ }
  }

  useEffect(() => {
    try { if (sessionStorage.getItem(OPEN_KEY) === "1") setOpenState(true); } catch { /* storage refused */ }
  }, []);

  /* The conversation so far, read back once the session is known. A failure
     here costs only the history — the dock still answers. */
  useEffect(() => {
    if (!ready || loaded || !isRouteLive("/john-lau")) return;
    let live = true;
    assistant.listTurns(30).then((res) => {
      if (!live) return;
      if (!res.error) setTurns((cur) => (cur.length ? cur : res.data));
      setLoaded(true);
    });
    return () => { live = false; };
  }, [ready, loaded]);

  /* The newest turn in view — a restored conversation opens at its end. */
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [turns.length, open, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setPrompt("");
    setBusy(true);
    const res = await assistant.ask(q, { pathname });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak terkirim", res.error.message); return; }
    setTurns((t) => [...t, res.data.turn]);
  }

  if (!ready) return null;

  /** **Not drawn where it cannot answer.**
   *
   *  The dock lives in the shell, so it appeared on all fourteen live routes
   *  while `assistant` had no implementation behind it — every question came
   *  back as a 501 in a warning toast. A button that is present and broken
   *  teaches people the application is unreliable; one that is absent teaches
   *  nothing at all, which is the better of the two until it works.
   *
   *  Gated on `isRouteLive("/john-lau")` rather than a flag of its own,
   *  because that answer is **derived**: `check-live-routes.mjs` adds the
   *  route the moment every `assistant.*` call it reaches exists. The dock
   *  turns itself on then, and nobody has to remember to flip anything.
   *
   *  Demo mode is unaffected — `isRouteLive` is true for everything there,
   *  which is the point of the demo.
   */
  if (!isRouteLive("/john-lau")) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          data-dock-open="john-lau" aria-label="Buka John Lau"
          className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-brand-700 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-brand-800 print:hidden"
        >
          <MessageSquare className="h-4 w-4" /> {t(MESSAGES.johnLau.launcher)}
        </button>
      )}

      {open && (
        <aside data-dock="john-lau" aria-label="Panel John Lau" className="fixed bottom-0 right-0 z-30 flex h-[min(78vh,720px)] w-full max-w-[420px] flex-col rounded-t-xl border border-slate-200 bg-white shadow-2xl sm:bottom-4 sm:right-4 sm:rounded-xl print:hidden">
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            <MessageSquare className="h-4 w-4 text-brand-700" />
            <span className="text-[13px] font-semibold text-slate-800">John Lau</span>
            <Badge tone="slate">demo</Badge>
            <button onClick={() => setOpen(false)} aria-label={t(MESSAGES.common.close)} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 && <Opening onPick={send} />}
            {turns.map((t, i) => (
              <Turn
                key={t.id} turn={t}
                pathname={pathname}
                current={i === lastGuide(turns)}
                onNavigate={(href) => router.push(href)}
                onChanged={(u) => setTurns((all) => all.map((x) => (x.id === u.id ? u : x)))}
              />
            ))}
            {busy && <p className="text-[12px] text-slate-400">…</p>}
            <div ref={bottom} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(prompt); }}
            className="flex items-center gap-2 border-t border-slate-200 px-3 py-2.5"
          >
            <input
              value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder={t(MESSAGES.johnLau.placeholder)}
              aria-label={t(MESSAGES.johnLau.ariaPrompt)}
              className="h-9 flex-1 rounded-lg border border-slate-200 px-2.5 text-sm focus:border-brand-400 focus:outline-none"
            />
            <Button size="sm" icon={Send} disabled={busy || !prompt.trim()}>{t(MESSAGES.common.send)}</Button>
          </form>
        </aside>
      )}
    </>
  );
}

function Opening({ onPick }: { onPick: (s: string) => void }) {
  const t = useT();
  const lang = useLang();
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-slate-700">{t(MESSAGES.johnLau.opening)}</p>
      <p className="text-[12px] text-slate-500">{t(MESSAGES.johnLau.openingClosed)}</p>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {EXAMPLES[lang].map((e) => (
          <button
            key={e} onClick={() => onPick(e)}
            className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:border-brand-300 hover:bg-brand-50"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The latest turn that has steps — the tutorial being followed. Only that
 *  one marks *you are here*, so an old guide further up does not light up as
 *  well when its screen happens to be open. */
function lastGuide(turns: AssistantTurn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].steps.length > 0) return i;
  return -1;
}

function Turn({ turn, pathname, current, onNavigate, onChanged }: {
  turn: AssistantTurn;
  pathname: string;
  current: boolean;
  onNavigate: (href: string) => void;
  onChanged: (t: AssistantTurn) => void;
}) {
  const { toast } = useToast();
  const t = useT();
  const [fields, setFields] = useState<Record<string, string>>(
    /* Keyed by `f.key`, never by `f.label`: the label is language-dependent,
       and a payload keyed by display text empties itself when somebody
       switches language between drafting and confirming. */
    Object.fromEntries((turn.draft?.fields ?? []).map((f) => [f.key, f.value.startsWith("—") ? "" : f.value])),
  );
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const res = await assistant.confirmDraft({ turn_id: turn.id, fields });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak jadi ditulis", res.error.message); return; }
    toast("success", "Tersimpan", res.data.produced_ref ?? "Rancangan dikonfirmasi");
    onChanged(res.data);
  }

  async function abandon() {
    const res = await assistant.abandonDraft(turn.id);
    if (res.data) onChanged(res.data);
  }

  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-xl bg-brand-600 px-3 py-1.5 text-[13px] text-white">{turn.prompt}</p>

      <div className={cn(
        "rounded-xl border px-3 py-2",
        turn.refused_because === "closed" ? "border-rose-200 bg-rose-50"
          : turn.refused_because === "permission" ? "border-amber-200 bg-amber-50"
            : "border-slate-200 bg-slate-50",
      )}>
        {/* Two different refusals, said differently. One is never lifted; the
            other is a grant away, and sending somebody to argue with the wrong
            person is what one shared header would do (F64). */}
        {turn.refused_because === "closed" && (
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-rose-800">
            <ShieldAlert className="h-3.5 w-3.5" /> {t(MESSAGES.johnLau.refusedClosed)}
          </p>
        )}
        {turn.refused_because === "permission" && (
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-amber-900">
            <KeyRound className="h-3.5 w-3.5" /> {t(MESSAGES.johnLau.refusedPermission)}
          </p>
        )}
        <p className="text-[13px] text-slate-700">{stripRefs(turn.text)}</p>

        {turn.facts.length > 0 && (
          <ul className="mt-2 space-y-1">
            {turn.facts.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-slate-600">{f.label}</span>
                {/* **The number is formatted here and nowhere else.** A fact
                    carries `amount` + `unit` rather than a finished string, so
                    John Lau's figure and the figure on the screen it points at
                    are the same characters and can be compared by eye (D217).
                    `value` is for everything that is not a number. */}
                <span className="font-medium tabular-nums text-slate-900">
                  {f.amount != null && f.unit === "IDR" ? formatIDR(f.amount) : f.value}
                </span>
                {f.href && (
                  <button onClick={() => onNavigate(f.href!)} aria-label="Buka layarnya" className="text-brand-700 hover:underline">
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {turn.steps.length > 0 && (
          <ol className="mt-2 space-y-2">
            {turn.steps.map((s, i) => {
              /* **You are here.** The tutorial follows the person: the step
                 whose screen is open is marked, so after *Buka di sini* the
                 panel says which of its steps this page is for. */
              const here = current && !!s.href && pathname === s.href;
              return (
              <li key={i} className={cn("text-[12px]", here && "-mx-1.5 rounded-lg bg-brand-50 px-1.5 py-1 ring-1 ring-brand-200")}>
                <span className="flex gap-2">
                  <span className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    here ? "bg-brand-700 text-white" : "bg-brand-100 text-brand-800",
                  )}>
                    {i + 1}
                  </span>
                  <span className="text-slate-700">
                    {here && (
                      <span className="mr-1 inline-flex items-center gap-0.5 rounded bg-brand-700 px-1 text-[10px] font-medium text-white">
                        <MapPin className="h-2.5 w-2.5" /> {t(MESSAGES.johnLau.youAreHere)}
                      </span>
                    )}
                    {stripRefs(s.text)}
                    {s.href && (
                      <button onClick={() => onNavigate(s.href!)} className="ml-1 inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline">
                        {t(MESSAGES.johnLau.openHere)} <ArrowUpRight className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </span>
                {s.rule && (
                  <span className="mt-0.5 block pl-6 text-[11px] italic text-slate-500">{s.rule}</span>
                )}
              </li>
              );
            })}
          </ol>
        )}

        {turn.draft && !turn.draft_outcome && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[12px] font-medium text-amber-900">{turn.draft.headline}</p>
            <div className="mt-1.5 space-y-1.5">
              {turn.draft.fields.map((f) => (
                <label key={f.key} className="block text-[11px] text-slate-600">
                  {f.label}
                  <input
                    value={fields[f.key] ?? ""} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                    placeholder={f.value}
                    className="mt-0.5 h-8 w-full rounded-lg border border-slate-200 px-2 text-[12px] focus:border-brand-400 focus:outline-none"
                  />
                </label>
              ))}
            </div>
            {turn.draft.warnings.map((w) => (
              <p key={w} className="mt-1.5 text-[11px] text-amber-900">{w}</p>
            ))}
            <div className="mt-2 flex gap-2">
              <Button size="sm" icon={Check} disabled={busy} onClick={confirm}>{t(MESSAGES.johnLau.writeIt)}</Button>
              <Button size="sm" variant="ghost" onClick={abandon}>{t(MESSAGES.common.cancel)}</Button>
            </div>
          </div>
        )}

        {turn.draft_outcome === "confirmed" && (
          <p className="mt-2 text-[12px] text-emerald-700">
            {t(MESSAGES.johnLau.savedAs)}{turn.produced_ref ? ` — ${turn.produced_ref}` : ""}.
          </p>
        )}
        {turn.draft_outcome === "abandoned" && (
          <p className="mt-2 text-[12px] text-slate-500">{t(MESSAGES.johnLau.abandoned)}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-200 pt-1.5 text-[10px] text-slate-400">
          {turn.tools_used.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 font-mono">
              {t.startsWith("ai.") ? <Sparkles className="h-3 w-3" />
                : t.startsWith("guide.") ? <BookOpen className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
              {t}
            </span>
          ))}
          {turn.route && (
            <Link href={turn.route} className="ml-auto text-brand-700 hover:underline">
              {t(MESSAGES.johnLau.openScreen)}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
