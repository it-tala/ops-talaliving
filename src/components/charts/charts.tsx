"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatCompact, formatIDRCompact, formatNumber } from "@/lib/format";

const BRAND = "#35825a";  // brand-600 — samakan kalau warna merek diganti
const GRID = "#e2e8f0";
const AXIS = "#94a3b8";
/* Enam hue yang jelas berbeda satu sama lain, dimulai dari warna merek.
   Emerald sengaja TIDAK dipakai di sini: terlalu dekat dengan brand-600 dan
   dua irisan bersebelahan jadi sulit dibedakan. */
export const PIE_COLORS = ["#35825a", "#38bdf8", "#f59e0b", "#8b5cf6", "#e11d48", "#64748b"];

/* Formatter tooltip menerima `ValueType` di recharts 3 — angka, teks, atau
   larik dari keduanya — bukan lagi `number`. Jadi nilainya dinormalkan dengan
   `Number()` di tempat pakai, bukan di-cast: cast hanya membungkam pengecek
   tipe, sementara sumbu dan format rupiah di bawah memang butuh angka. */
const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  boxShadow: "0 8px 24px -8px rgb(15 23 42 / 0.15)",
  fontSize: 12,
  padding: "8px 12px",
};

export function AreaTrend({
  data,
  dataKey,
  height = 260,
  currency = true,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  height?: number;
  currency?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="brandFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.25} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v) => (currency ? formatCompact(Number(v)) : formatNumber(Number(v)))}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => [currency ? formatIDRCompact(Number(v)) : formatNumber(Number(v)), ""]}
        />
        <Area type="monotone" dataKey={dataKey} stroke={BRAND} strokeWidth={2.5} fill="url(#brandFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarSeries({
  data,
  dataKey,
  height = 260,
  currency = true,
  color = BRAND,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  height?: number;
  currency?: boolean;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v) => (currency ? formatCompact(Number(v)) : formatNumber(Number(v)))}
        />
        <Tooltip
          cursor={{ fill: "#f4f6fa" }}
          contentStyle={tooltipStyle}
          formatter={(v) => [currency ? formatIDRCompact(Number(v)) : formatNumber(Number(v)), ""]}
        />
        <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  height = 240,
}: {
  data: { name: string; value: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={90} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v)}%`, ""]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DualLine({
  data,
  height = 280,
}: {
  data: Record<string, unknown>[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatIDRCompact(Number(v)), ""]} />
        <Line type="monotone" dataKey="pendapatan" stroke={BRAND} strokeWidth={2.5} dot={false} />
        <Line type="monotone" dataKey="laba" stroke="#34d399" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
