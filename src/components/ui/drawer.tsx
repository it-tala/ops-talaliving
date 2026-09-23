"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/* Panels open on top of panels: the ledger's transaction opens the request
   line it paid, without leaving the page. Escape and the scroll lock have to
   belong to the top one only — otherwise one keypress closes both, and the
   inner panel closing unlocks the page behind the outer one still open. */
const openStack: symbol[] = [];

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  /* Read through a ref so a parent re-rendering with a new closure does not
     re-run the effect — which would move this panel to the top of the stack. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const me = Symbol("drawer");
    openStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openStack[openStack.length - 1] === me) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      openStack.splice(openStack.indexOf(me), 1);
      if (openStack.length === 0) document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />
      <div className={cn("relative flex h-full w-full flex-col bg-white shadow-drawer animate-slide-in", width)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />
      <div className={cn("relative w-full rounded-2xl bg-white shadow-xl animate-fade-in", width)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
