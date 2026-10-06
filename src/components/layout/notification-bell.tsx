"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ClipboardList, GitPullRequest, Inbox, PackageCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { identity } from "@/demo/api";
import { subscribe } from "@/demo/store";
import { isLiveMode } from "@/lib/live";
import { useTr } from "@/lib/i18n";
import type { AppNotification } from "@/services/identity/contracts";

/** How often the bell asks. A minute: a task is not an alarm, and the Chat
 *  message (john-lau's `ops notify`) is the road for somebody away from the
 *  screen. */
const POLL_MS = 60_000;

function dmy(d: unknown): string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}-${m}-${y}`;
}

function ago(at: string, tr: (en: string, id: string) => string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 1) return tr("just now", "baru saja");
  if (mins < 60) return tr(`${mins} min ago`, `${mins} mnt lalu`);
  const hours = Math.round(mins / 60);
  if (hours < 24) return tr(`${hours} h ago`, `${hours} jam lalu`);
  return tr(`${Math.round(hours / 24)} d ago`, `${Math.round(hours / 24)} hari lalu`);
}

/** The line for one notification, in the reader's language. A kind this
 *  screen does not know falls back to the database's own sentence. */
function Line({ n }: { n: AppNotification }) {
  const tr = useTr();
  const d = n.data as Record<string, string | number | boolean | null>;
  if (n.kind === "task.assigned") {
    return (
      <>
        <span className="font-medium text-slate-800">{String(d.title ?? "")}</span>
        <span className="block text-[12px] text-slate-500">
          {d.moved ? tr("Moved to you by", "Dipindahkan ke Anda oleh") : d.routine ? tr("Routine, from", "Tugas rutin, dari") : tr("New task from", "Tugas baru dari")}{" "}
          {String(d.assigned_by ?? "HRD")} · {tr("due", "jatuh tempo")} {dmy(d.due_date)}
          {d.goal_title ? <> · #{String(d.goal_rank ?? "")} {String(d.goal_title)}</> : null}
        </span>
      </>
    );
  }
  if (n.kind === "task.delivered") {
    return (
      <>
        <span className="font-medium text-slate-800">{String(d.title ?? "")}</span>
        <span className="block text-[12px] text-slate-500">
          {tr("Handed over by", "Diserahkan oleh")} {String(d.assignee ?? "")}
          {d.late ? <span className="text-amber-700"> · {tr("late", "terlambat")}</span> : null}
        </span>
        {d.delivered_note ? (
          <span className="mt-0.5 block line-clamp-2 text-[12px] text-slate-600">“{String(d.delivered_note)}”</span>
        ) : null}
      </>
    );
  }
  if (n.kind === "task.github_pr") {
    return (
      <>
        <span className="font-medium text-slate-800">{String(d.title ?? "")}</span>
        <span className="block text-[12px] text-slate-500">
          {d.merged ? tr("Merged PR", "PR di-merge") : "PR"} {String(d.repo ?? "")}#{String(d.number ?? "")}{" "}
          {tr("by", "oleh")} @{String(d.author_login ?? "")}
          {d.reason === "unmapped"
            ? tr(" (login not mapped)", " (login belum dipetakan)")
            : <> ({String(d.author_name ?? "")})</>}
        </span>
        <span className="block text-[12px] text-amber-700">
          {tr(`Not from the holder (${String(d.assignee ?? "")}) — the task stays open. Decide: close it, or move it.`,
              `Bukan dari pemegang tugas (${String(d.assignee ?? "")}) — tugas tetap terbuka. Putuskan: tutup, atau pindahkan.`)}
        </span>
      </>
    );
  }
  if (n.kind === "backlog.proposed") {
    return (
      <>
        <span className="font-medium text-slate-800">{String(d.title ?? "")}</span>
        <span className="block text-[12px] text-slate-500">
          {tr("Proposed for the waiting list by", "Diusulkan ke daftar tunggu oleh")} {String(d.by ?? "")}
          {d.unit ? <> · {String(d.unit)}</> : null}
        </span>
      </>
    );
  }
  if (n.kind === "backlog.accepted" || n.kind === "backlog.dropped") {
    return (
      <>
        <span className="font-medium text-slate-800">{String(d.title ?? "")}</span>
        <span className="block text-[12px] text-slate-500">
          {n.kind === "backlog.accepted"
            ? tr(`Your proposal is on the waiting list at #${String(d.position ?? "")}`, `Usulan Anda masuk daftar tunggu di urutan #${String(d.position ?? "")}`)
            : <>{tr("Your proposal was not taken:", "Usulan Anda tidak diambil:")} {String(d.reason ?? "")}</>}
        </span>
      </>
    );
  }
  return <span className="text-slate-800">{n.title}</span>;
}

/** The bell (D374): what reached this person — a task given to them, or a
 *  task handed over to HRD. Written by the database, never by a screen, so it
 *  cannot say something happened that did not. */
export function NotificationBell() {
  const tr = useTr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<AppNotification[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const count = useCallback(async () => {
    const res = await identity.countUnreadNotifications();
    if (!res.error) setUnread(res.data);
  }, []);

  const load = useCallback(async () => {
    const res = await identity.listNotifications({ limit: 30 });
    if (!res.error) setRows(res.data);
  }, []);

  useEffect(() => {
    void count();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void count(); }, POLL_MS);
    const onFocus = () => void count();
    window.addEventListener("focus", onFocus);
    /* In the sandbox the "database" is in this tab: a task assigned from the
       persona picker should ring at once, not a minute later. */
    const off = isLiveMode() ? () => {} : subscribe(() => void count());
    return () => { window.clearInterval(t); window.removeEventListener("focus", onFocus); off(); };
  }, [count]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDown = (e: MouseEvent) => {
      const at = e.target as Node;
      if (!box.current?.contains(at) && !panel.current?.contains(at)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, load]);

  async function go(n: AppNotification) {
    setOpen(false);
    if (n.read_at === null) {
      await identity.markNotificationsRead([n.id]);
      void count();
    }
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    await identity.markNotificationsRead(null);
    await Promise.all([count(), load()]);
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={tr(`Notifications, ${unread} unread`, `Notifikasi, ${unread} belum dibaca`)}
        aria-expanded={open}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Portalled to <body>: the header's backdrop-blur makes it the
          containing block of anything `fixed` inside it, which would clip
          this panel to the header's 64px (the same trap the drawer is kept
          out of in topbar.tsx). */}
      {open && createPortal(
        <div ref={panel} className="fixed inset-x-2 top-[68px] z-40 max-h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:inset-x-auto sm:right-4 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">{tr("Notifications", "Notifikasi")}</span>
            {unread > 0 && (
              <button type="button" onClick={() => void readAll()}
                className="flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline">
                <CheckCheck className="h-3.5 w-3.5" />{tr("Mark all read", "Tandai semua dibaca")}
              </button>
            )}
          </div>
          <div className="max-h-[calc(70vh-44px)] overflow-y-auto">
            {rows === null ? (
              <p className="px-4 py-6 text-center text-[13px] text-slate-400">{tr("Loading…", "Memuat…")}</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                {tr("Nothing yet. New tasks and hand-overs show here.", "Belum ada. Tugas baru dan serah tugas muncul di sini.")}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((n) => {
                  const Icon = n.kind === "task.delivered" ? PackageCheck : n.kind === "task.github_pr" ? GitPullRequest : n.kind.startsWith("backlog.") ? Inbox : ClipboardList;
                  return (
                    <li key={n.id}>
                      <button type="button" onClick={() => void go(n)}
                        className={cn("flex w-full gap-3 px-4 py-3 text-left text-[13px] hover:bg-slate-50",
                          n.read_at === null && "bg-brand-50/60")}>
                        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0",
                          n.kind === "task.delivered" ? "text-emerald-600" : "text-brand-600")} />
                        <span className="min-w-0 flex-1">
                          <Line n={n} />
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            {n.entity_no} · {ago(n.created_at, tr)}
                          </span>
                        </span>
                        {n.read_at === null && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
