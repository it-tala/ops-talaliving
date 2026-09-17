"use client";

import { MessageSquare, ShieldAlert, Wrench, BookOpen, PencilLine } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { assistant } from "@/demo/api";
import type { AssistantTool } from "@/services/assistant/contracts";

/** What John Lau may do, written down where anybody can read it.
 *
 *  The catalogue is the security boundary (D218), and a boundary nobody can
 *  read is a boundary nobody can check. So it is a page: every capability,
 *  what it needs, and — for the ones that are closed — the reason in full,
 *  the same sentence the assistant gives when somebody asks.
 *
 *  Blocked entries are listed rather than hidden. A capability that is absent
 *  teaches people to rephrase until something works; one that is present and
 *  refused ends the conversation honestly.
 */
export default function JohnLauPage() {
  const [tools, reload] = useLoad(() => assistant.listTools(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="John Lau"
        title="Apa yang boleh ditanyakan"
        description="John Lau menjalankan perintah bernama dan menunjukkan hasilnya. Ia tidak mengarang angka, tidak bekerja dengan hak lebih besar dari Anda, dan tidak menulis apa pun tanpa konfirmasi kedua."
        actions={<SourceBadge state={tools} />}
      />

      <div className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700 shadow-card">
        <p>
          <strong className="font-medium">Setiap angka punya sumbernya.</strong> Jawaban John Lau
          berisi nama perhitungan yang menghasilkannya dan tautan ke layar yang menampilkan angka
          yang sama. Kalau tidak ada perhitungan yang menjawab, jawabannya <em>saya tidak tahu</em> —
          bukan tebakan yang terdengar meyakinkan.
        </p>
        <p>
          <strong className="font-medium">Ia bekerja dengan hak Anda.</strong> Tiap perintah lewat
          pemeriksaan izin yang sama dengan layarnya. Asisten yang bisa membaca lebih banyak
          daripada orang yang mengetik membuat izin di aplikasi ini tidak berarti apa-apa.
        </p>
        <p>
          <strong className="font-medium">Pemahaman kalimatnya belum nyata.</strong> Di tahap ini
          yang mencocokkan kalimat ke perintah adalah pencocok kata kunci, bukan model bahasa.
          Yang sudah nyata adalah daftar di bawah, pemeriksaan izinnya, dan langkah konfirmasinya —
          bagian yang tidak berubah waktu model bahasanya dipasang.
        </p>
      </div>

      <Loaded state={tools} onRetry={reload}>
        {(all) => {
          const blocked = all.filter((t) => t.reach === "blocked");
          const reads = all.filter((t) => t.reach === "open" && t.effect === "read");
          const guides = all.filter((t) => t.reach === "open" && t.effect === "guide");
          const writes = all.filter((t) => t.reach === "open" && t.effect === "write");

          return (
            <div className="space-y-4">
              <Card className="border-rose-200">
                <CardHeader
                  title={`${blocked.length} hal yang tidak bisa lewat prompt, pada tingkat akses mana pun`}
                  subtitle="Ini bukan tingkat izin — tidak ada grant yang membukanya. Daftar ini ada di kode sebagai data yang dibaca penyalur perintah, bukan sebagai kalimat perintah ke sebuah model."
                  icon={ShieldAlert}
                />
                <ul className="divide-y divide-slate-100">
                  {blocked.map((t) => <Row key={t.name} tool={t} />)}
                </ul>
              </Card>

              <Card>
                <CardHeader title={`${reads.length} pertanyaan data`} icon={Wrench} />
                <ul className="divide-y divide-slate-100">{reads.map((t) => <Row key={t.name} tool={t} />)}</ul>
              </Card>

              <Card>
                <CardHeader title={`${guides.length} petunjuk cara kerja`}
                  subtitle="Dijawab sebagai langkah beserta aturan di baliknya, dan layarnya bisa dibuka sambil panduannya tetap terbaca."
                  icon={BookOpen} />
                <ul className="divide-y divide-slate-100">{guides.map((t) => <Row key={t.name} tool={t} />)}</ul>
              </Card>

              <Card>
                <CardHeader title={`${writes.length} hal yang bisa disiapkan untuk ditulis`}
                  subtitle="Selalu sebagai rancangan. Tiap kolom ditampilkan utuh dan harus dikonfirmasi sekali lagi — konfirmasi atas ringkasan adalah konfirmasi atas ringkasannya."
                  icon={PencilLine} />
                <ul className="divide-y divide-slate-100">{writes.map((t) => <Row key={t.name} tool={t} />)}</ul>
              </Card>
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

function Row({ tool }: { tool: AssistantTool }) {
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-slate-800">{tool.label}</span>
        {tool.module && (
          <Badge tone="slate">{tool.module} · {tool.level}</Badge>
        )}
        {tool.reach === "blocked" && <Badge tone="red">tertutup</Badge>}
        <span className="ml-auto font-mono text-[10px] text-slate-400">{tool.name}</span>
      </div>
      {tool.blocked_reason && (
        <p className="mt-1 text-[12px] text-slate-600">{tool.blocked_reason}</p>
      )}
      {tool.instead_at && (
        <p className="mt-1 text-[11px]">
          <Link href={tool.instead_at} className="text-brand-700 hover:underline">
            {tool.reach === "blocked" ? "Yang boleh, di layarnya" : "Layarnya"}: {tool.instead_at}
          </Link>
        </p>
      )}
    </li>
  );
}
