"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Factory, X } from "lucide-react";
import { NAV } from "@/lib/nav";
import { useBrand } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { MESSAGES } from "@/lib/messages";
import { useSession } from "@/store/session";
import { cn } from "@/lib/cn";

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const brand = useBrand();
  const t = useT();
  const pathname = usePathname();
  const { can } = useSession();

  // Seksi yang memuat rute aktif terbuka sendiri saat halaman dimuat, supaya
  // pengguna tidak perlu mencari di mana dirinya berada.
  const activeSectionTitle =
    NAV.find((s) => s.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/")))?.title ?? NAV[0].title;
  const [openSections, setOpenSections] = useState<string[]>([activeSectionTitle]);

  const toggle = (title: string) =>
    setOpenSections((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));

  const content = (
    <div className="flex h-full flex-col bg-brand-900 text-brand-100">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm">
          <Factory className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-tight text-white">{brand.name}</p>
          <p className="truncate text-[10px] uppercase tracking-wider text-brand-300">{brand.tagline}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-brand-200 hover:bg-white/10 lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4 no-scrollbar">
        {NAV.map((section) => {
          // Item yang tidak diizinkan tidak dirender sama sekali; seksi yang
          // jadi kosong ikut hilang, bukan tampil sebagai judul tanpa isi.
          const visibleItems = section.items.filter((i) => can(i.permission) || (i.orPermission ? can(i.orPermission) : false));
          if (visibleItems.length === 0) return null;

          const isOpen = openSections.includes(section.title);
          const SectionIcon = section.icon;
          const hasActive = visibleItems.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));

          return (
            <div key={section.title}>
              <button
                onClick={() => toggle(section.title)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  hasActive ? "text-white" : "text-brand-200 hover:bg-white/5 hover:text-white",
                )}
              >
                <SectionIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{section.titleKey ? t(MESSAGES.nav[section.titleKey]) : section.title}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
              </button>

              {isOpen && (
                <div className="mb-1 ml-4 space-y-0.5 border-l border-white/10 pl-3 pt-0.5">
                  {visibleItems.map((item) => {
                    const active = pathname === item.href;
                    const ItemIcon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                          active
                            ? "bg-white font-semibold text-brand-700 shadow-sm"
                            : "text-brand-200 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <ItemIcon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{item.labelKey ? t(MESSAGES.nav[item.labelKey]) : item.label}</span>
                        {item.badge === "core" && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                              active ? "bg-brand-100 text-brand-700" : "bg-white/10 text-brand-200",
                            )}
                          >
                            Core
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-3">
        <p className="text-[11px] text-brand-300">{brand.name}</p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-72 shrink-0 lg:block">{content}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
          <div className="absolute left-0 top-0 h-full w-72 animate-fade-in">{content}</div>
        </div>
      )}
    </>
  );
}
