"use client";

import { stripRefs } from "@/lib/refs";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastLevel = "info" | "success" | "warning" | "critical";

export interface Toast {
  id: number;
  level: ToastLevel;
  title: string;
  message?: string;
}

interface ToastValue {
  toasts: Toast[];
  toast: (level: ToastLevel, title: string, message?: string) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/** Notifikasi terpusat.
 *
 *  Dipisah dari store sesi supaya komponen mana pun bisa memberi umpan balik
 *  tanpa ikut menarik seluruh keadaan aplikasi — dan supaya `Toaster` tidak
 *  ikut render ulang setiap kali hal lain berubah.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (level: ToastLevel, title: string, message?: string) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, level, title: stripRefs(title), message: stripRefs(message) }]);
      // Kesalahan dibiarkan sampai ditutup sendiri: pesan yang hilang setelah
      // empat detik adalah pesan yang tidak sempat dibaca orang yang sedang
      // menatap bagian lain layar.
      if (level !== "critical") {
        window.setTimeout(() => dismissToast(id), 4000);
      }
    },
    [dismissToast],
  );

  const value = useMemo<ToastValue>(() => ({ toasts, toast, dismissToast }), [toasts, toast, dismissToast]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast harus dipakai di dalam ToastProvider.");
  return ctx;
}
