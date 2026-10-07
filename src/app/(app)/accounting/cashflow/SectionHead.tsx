"use client";

export function SectionHead({ n, title, action }: { n: number; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[13px] font-bold text-white">{n}</span>
      <h2 className="text-base font-semibold text-slate-800 md:text-lg">{title}</h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
