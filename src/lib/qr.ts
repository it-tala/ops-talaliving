/** A QR code, as geometry rather than an image (D263).
 *
 *  **It holds a URL, and the code is printed in plain type beside it.**
 *
 *  The first version of this file held the opposite, and argued it well: put
 *  the bare code — `kol-26-09-02_01` — in the QR, so a label glued to a wooden
 *  crate makes no promise about a hostname it has to keep for years. The
 *  argument was sound and the conclusion was wrong, because it never asked
 *  what the person scanning is holding. They are holding the phone they own,
 *  using its own camera, standing on a site. A camera that reads a bare code
 *  shows them a line of text to retype. A camera that reads a URL opens the
 *  box straight on the screen. The code-only label only pays off if we ship a
 *  camera scanner inside the app — and `BarcodeDetector` does not exist on
 *  iOS Safari, so that means a WASM decoder in the bundle to rescue a design
 *  that was supposed to be the simple one (F83).
 *
 *  The hostname objection survives, and is answered by the label rather than
 *  by the QR: the code is printed underneath in mono, large enough to type.
 *  A moved domain degrades a label to exactly what the code-only design would
 *  have given us on its best day. And because the URL is built from whatever
 *  host the label was printed from, it is right for as long as that host is.
 *
 *  Measured, not assumed: at the 26 mm the label layout gives it, a URL on
 *  our own domain is 33 modules — 0.79 mm each, against the ~0.5 mm a phone
 *  needs at arm's length. Even a long Vercel preview host stays at 0.70 mm.
 *  The URL costs nothing a crate label can feel.
 *
 *  It is rendered as SVG paths, not a data URL. An `<img src="data:...">` is a
 *  bitmap, and a bitmap on a laser printer at that size is the difference
 *  between a scan that works from the tailgate and one that needs three tries.
 *  Vector modules stay square at any DPI.
 */
import qrcode from "qrcode-generator";

export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** `dark[row][col]`. */
  dark: boolean[][];
  /** Modules of white margin the spec requires around it. */
  quiet: number;
}

/** Error correction `M` — 15% recoverable. `L` is tempting for a smaller code,
 *  but these labels get dusty, scuffed and rained on between the workshop and
 *  a site, and a 15% margin is what survives that. */
export function qrMatrix(text: string, level: "L" | "M" | "Q" | "H" = "M"): QrMatrix {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const dark: boolean[][] = [];
  for (let r = 0; r < size; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c += 1) row.push(qr.isDark(r, c));
    dark.push(row);
  }
  return { size, dark, quiet: 4 };
}

/** One SVG path covering every dark module, in a viewBox of
 *  `size + 2 × quiet` units. One path rather than thousands of rects: a sheet
 *  of forty labels is forty paths, and the print dialog opens instantly. */
export function qrPath(m: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < m.size; r += 1) {
    let run = 0;
    for (let c = 0; c <= m.size; c += 1) {
      const dark = c < m.size && m.dark[r][c];
      if (dark) { run += 1; continue; }
      if (run > 0) {
        /* Emit the finished run as one rectangle, so a row of eight modules is
           one `h8` rather than eight separate squares. */
        parts.push(`M${m.quiet + c - run} ${m.quiet + r}h${run}v1h-${run}z`);
        run = 0;
      }
    }
  }
  return parts.join("");
}

export function qrViewBox(m: QrMatrix): string {
  const side = m.size + m.quiet * 2;
  return `0 0 ${side} ${side}`;
}
