"use client";

import { useEffect, useState } from "react";
import { qrMatrix, qrPath, qrViewBox } from "@/lib/qr";

/** The host the page is being viewed from, once the browser has told us.
 *
 *  `null` on the first render, always. A QR is the one thing on a page that
 *  must not be drawn from a guess — a label printed with a placeholder host
 *  looks exactly like a working label and fails in somebody's hand.
 */
export function useOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** A QR code as vector geometry.
 *
 *  Give it `path` — `/box/kol-26-09-02_01` — and it encodes that against the
 *  host the label is being printed from. Give it `value` and it encodes that
 *  verbatim, for the rare code that is not a place in this application.
 *
 *  `shapeRendering="crispEdges"` matters more than it looks. Without it a
 *  browser antialiases the module edges, and a scanner reading a small label
 *  at an angle sees grey where it needs black or white.
 */
export function QrCode({
  value,
  path,
  size = 96,
  className,
  title,
}: {
  value?: string;
  path?: string;
  /** Rendered side in px (or any CSS length via `className`). */
  size?: number;
  className?: string;
  title?: string;
}) {
  const origin = useOrigin();
  const text = path ? (origin ? `${origin}${path}` : null) : value ?? null;

  if (text === null) {
    /* Holds the space so a label does not reflow when the code appears, and
       stays blank rather than showing a QR built from a guessed host. */
    return <div style={{ width: size, height: size }} className={className} aria-hidden />;
  }

  const m = qrMatrix(text);
  return (
    <svg
      viewBox={qrViewBox(m)}
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? text}
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={qrPath(m)} fill="#000" />
    </svg>
  );
}
