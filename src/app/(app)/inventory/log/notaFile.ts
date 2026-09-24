/** A phone photo of a nota, made small enough to send.
 *
 *  A phone takes a 4000-pixel, 5 MB picture of a piece of paper the size of a
 *  hand. The model reads the same nota at 2000 pixels, and the smaller file
 *  crosses a workshop's network in a second rather than twenty. Drawing it
 *  through a canvas also turns whatever the phone produced — HEIC on an iPhone
 *  — into a JPEG, which is what the reader accepts.
 *
 *  A PDF is sent as it is. Anything the browser cannot draw is sent as it is
 *  too, and the server says plainly if it cannot read it.
 */
const LONG_EDGE = 2000;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** A vendor from the name printed on the nota — a suggestion for the picker,
 *  never a choice made for anybody. `CV Sumber Kayu Jati` and `SUMBER KAYU
 *  JATI` are the same business; the legal form is not part of the name. */
export function matchVendor<T extends { id: string; name: string }>(printed: string | null, vendors: T[]): T | null {
  if (!printed) return null;
  const norm = (s: string) => s.toLowerCase().replace(/\b(cv|ud|pt|tb|tk|toko)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const p = norm(printed);
  if (p.length < 3) return null;
  return vendors.find((v) => {
    const n = norm(v.name);
    return n.length >= 3 && (p.includes(n) || n.includes(p));
  }) ?? null;
}
