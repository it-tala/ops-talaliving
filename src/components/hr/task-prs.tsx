"use client";

import { GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";
import type { TaskPullRequest } from "@/services/hr/contracts";

/** The GitHub PRs that named one task (D382), under the task's line.
 *
 *  Every PR is printed, the holder's or not: the owner's rule is that a PR
 *  from somebody else is *recorded on the task* and HRD decides, so it must
 *  be visible where HRD decides — here. A PR that is not the holder's says
 *  so in amber. */
export function TaskPrs({ prs, open = true }: { prs: TaskPullRequest[] | undefined; open?: boolean }) {
  const tr = useTr();
  if (!prs?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {prs.map((p) => {
        const Icon = p.state === "merged" ? GitMerge : p.state === "closed" ? GitPullRequestClosed : GitPullRequest;
        return (
          <li key={`${p.repo}#${p.pr_number}`} className="text-[12px]">
            <a href={p.url} target="_blank" rel="noreferrer"
               className={cn("inline-flex items-center gap-1 hover:underline",
                 p.state === "merged" ? "text-violet-700" : p.state === "closed" ? "text-slate-400" : "text-brand-700")}>
              <Icon className="h-3.5 w-3.5" />
              <span className="font-mono">{p.repo.split("/")[1]}#{p.pr_number}</span>
              <span className="text-slate-600">{p.title}</span>
            </a>
            <span className="text-slate-400">
              {" · "}@{p.author_login}
              {" · "}{p.state === "merged" ? tr("merged", "di-merge") : p.state === "closed" ? tr("closed", "ditutup") : p.draft ? tr("draft", "draf") : tr("open", "terbuka")}
            </span>
            {!p.by_assignee && (
              <span className={open ? "text-amber-700" : "text-slate-400"}>
                {" · "}{open
                  ? tr("not from the task holder — HRD decides", "bukan dari pemegang tugas — HRD memutuskan")
                  : tr("not from the task holder", "bukan dari pemegang tugas")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Group a reader's PR list by task number. */
export function prsByTask(rows: TaskPullRequest[] | undefined): Map<string, TaskPullRequest[]> {
  const out = new Map<string, TaskPullRequest[]>();
  for (const p of rows ?? []) out.set(p.task_no, [...(out.get(p.task_no) ?? []), p]);
  return out;
}
