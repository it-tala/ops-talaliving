"use client";

import { useState } from "react";
import { ExternalLink, FileText, Link2, ImageOff } from "lucide-react";

/** The picture of the document, wherever a document is being decided about.
 *
 *  Verification is *compare the paper with the figures*, and until now this
 *  screen asked people to do that from a filename (B3). A filename is not
 *  evidence of anything.
 *
 *  **What is drawn here in Phase 1 is a stand-in, and it says so on its face.**
 *  There are no real scans in the sandbox, so inventing a photograph of a nota
 *  would teach the one thing this project refuses to teach — a figure that
 *  looks true and is not. What it does instead is draw a sheet carrying the
 *  facts we actually hold: the filename, the kind, what was read off it, and
 *  the confidence of that reading. In Phase 2 the same slot shows the file
 *  itself; nothing else about the screen changes.
 */
export interface PreviewDoc {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  url: string | null;
  uploaded_at: string;
  uploaded_by_name?: string;
  kind?: string | null;
  read?: {
    vendor_name?: string | null;
    document_date?: string | null;
    amount_idr?: number | null;
    doc_type?: string | null;
    confidence?: number | null;
  };
}

const idr = (n: number) => `Rp ${n.toLocaleString("en-US")}`;

/** `url` on a captured-evidence attachment is a Drive **share page**
 *  (`file_evidence()`, `0038` — the capture worker passes a `webViewLink`),
 *  not a byte stream: `https://drive.google.com/file/d/<id>/view?…`. An
 *  `<img>` pointed at that renders nothing — the page loads, HTML is not a
 *  picture. Drive's `thumbnail` endpoint serves the same file's actual
 *  pixels for the same viewer who could already open the share link, so the
 *  id is pulled out of it rather than asking for a second URL nothing in
 *  this schema stores. Anything that is not a Drive file link (an
 *  `attach_file` upload, `storage_path` only, no matching id) is left alone
 *  and falls through to the stand-in sheet below, same as before. */
function driveThumbnailUrl(url: string): string | null {
  const m = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600` : null;
}

export function DocumentPreview({ doc, height = 340 }: { doc: PreviewDoc; height?: number }) {
  const isLink = doc.mime === "text/uri-list" || (doc.url != null && !doc.mime.startsWith("image/"));
  const isImage = doc.mime.startsWith("image/");
  const [imgFailed, setImgFailed] = useState(false);
  const imgSrc = doc.url ? (driveThumbnailUrl(doc.url) ?? doc.url) : null;

  if (isLink) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 text-center"
        style={{ height }}
      >
        <Link2 className="h-6 w-6 text-slate-400" />
        <p className="text-[13px] font-medium text-slate-700">Ini alamat, bukan berkas</p>
        <p className="max-w-xs break-all font-mono text-[11px] text-slate-500">{doc.url}</p>
        {doc.url && (
          <a
            href={doc.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline"
          >
            Buka di tab baru <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <p className="max-w-xs text-[11px] text-slate-400">
          Halaman toko bisa berubah atau hilang. Ia bukti pendukung, tidak pernah bukti utama (D125).
        </p>
      </div>
    );
  }

  /* A real file, once there is one. `onError` catches the case the id
     regex above cannot: a private file the viewer's own session cannot
     open, or a link shaped some other way entirely — either way, the stand-in
     sheet is a better answer than a broken-image icon.
     Clicking it opens `doc.url` — the Drive share page itself, already a
     full-size viewer with its own zoom — rather than building a second,
     in-app one: the cheaper of the two ways to let someone see it full size. */
  if (isImage && imgSrc && !imgFailed) {
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc} alt={doc.filename}
        onError={() => setImgFailed(true)}
        className="w-full rounded-xl border border-slate-200 object-contain transition-opacity hover:opacity-90"
        style={{ height }}
      />
    );
    return doc.url ? (
      <a href={doc.url} target="_blank" rel="noreferrer" title="Buka ukuran penuh di Google Drive">
        {img}
      </a>
    ) : img;
  }

  const read = doc.read ?? {};
  const unread = read.vendor_name == null && read.amount_idr == null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white" style={{ height }}>
      {/* The stand-in sheet. Deliberately drawn as a form, not as a photograph:
          it must never be mistaken for a scan somebody could zoom into. */}
      <div className="absolute inset-0 flex flex-col px-5 py-4">
        <div className="flex items-start justify-between border-b border-dashed border-slate-200 pb-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-800">
              {read.vendor_name ?? "Vendor tidak terbaca"}
            </p>
            <p className="text-[11px] text-slate-500">
              {read.doc_type ?? doc.kind ?? "Dokumen"}
              {read.document_date && ` · ${read.document_date}`}
            </p>
          </div>
          <FileText className="h-4 w-4 shrink-0 text-slate-300" />
        </div>

        <div className="flex flex-1 flex-col justify-center">
          {read.amount_idr != null ? (
            <>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Nilai terbaca</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900">{idr(read.amount_idr)}</p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] text-amber-700">
              <ImageOff className="h-4 w-4" /> Nilainya tidak terbaca — harus dibaca dari kertasnya
            </p>
          )}
          {read.confidence != null && (
            <p className="mt-1 text-[11px] text-slate-400">
              pembacaan mesin {read.confidence}% yakin
              {read.confidence < 70 && " — perlu dilihat sendiri"}
            </p>
          )}
        </div>

        <div className="border-t border-dashed border-slate-200 pt-2">
          <p className="truncate font-mono text-[10px] text-slate-500">{doc.filename}</p>
          <p className="text-[10px] text-slate-400">
            {(doc.bytes / 1024).toFixed(0)} KB · diunggah {doc.uploaded_at.slice(0, 10)}
            {doc.uploaded_by_name && ` oleh ${doc.uploaded_by_name}`}
          </p>
        </div>
      </div>

      {/* Said on the face of it, not in a caption underneath, because a
          screenshot of this crops the caption off. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="-rotate-[18deg] select-none text-[34px] font-black uppercase tracking-widest text-slate-900/[0.055]">
          {unread ? "belum terbaca" : "contoh — bukan pindaian"}
        </span>
      </div>
    </div>
  );
}
