/** The guided walk.
 *
 *  Flow B, as `00-context.md` names it: request → approval → payment →
 *  receiving. It exists because the demo is walked with people who have never
 *  seen it, and "click Requests, then the meeting board, then…" said out loud
 *  gets lost in the room. The tour says it on the screen instead, one step at
 *  a time, on the real pages with the real data — not a slideshow of pictures
 *  of the app (D117).
 *
 *  Two rules it keeps. It never blocks anything: every control on the page
 *  underneath still works, and somebody who wanders off is not corrected.
 *  And each step says **what to look at and why it matters**, never just where
 *  to click — a tour that only points is a worse version of a menu.
 */
import type { Message } from "@/lib/i18n";

export interface TourStep {
  href: string;
  title: Message;
  /** What to look at on this screen, and the reason it is on the walk. */
  body: Message;
}

export interface Tour {
  id: string;
  name: Message;
  steps: TourStep[];
}

export const FLOW_B: Tour = {
  id: "flow-b",
  name: {
    en: "Flow B — from a request to money leaving",
    id: "Flow B — dari permintaan sampai uang keluar",
  },
  steps: [
    {
      href: "/procurement/pr",
      title: {
        en: "It starts as a line, not a document",
        id: "Semuanya berawal dari satu baris, bukan dokumen",
      },
      body: {
        en: "Every row here is one item somebody asked for. Open one: the status, who approved it, what was actually paid against it, and every file attached to it are all on the line — because that is the thing a question is ever asked about.",
        id: "Setiap baris di sini adalah satu barang yang diminta seseorang. Buka salah satunya: status, siapa yang menyetujui, berapa yang benar-benar dibayar untuknya, dan setiap berkas yang dilampirkan ada di baris itu — karena baris itulah yang selalu ditanyakan orang.",
      },
    },
    {
      href: "/procurement/meeting",
      title: {
        en: "The meeting decides what gets paid",
        id: "Rapat memutuskan apa yang dibayar",
      },
      body: {
        en: "Tick what should be approved. The total to pay and the balance in BCA 271 sit above the list, so the room can see whether the money is there before anybody says yes.",
        id: "Centang yang perlu disetujui. Total yang harus dibayar dan saldo BCA 271 ada di atas daftar, sehingga semua yang hadir bisa melihat apakah uangnya ada sebelum ada yang berkata ya.",
      },
    },
    {
      href: "/demo/chat",
      title: {
        en: "Approval is answered by the approver",
        id: "Persetujuan dijawab oleh yang berwenang",
      },
      body: {
        en: "The meeting laptop is usually not the CEO's. So the request goes to Chat as one card with its totals, and whoever answers it signs it — the name on the record is theirs, not the laptop's.",
        id: "Laptop rapat biasanya bukan milik CEO. Jadi permintaan dikirim ke Chat sebagai satu kartu beserta totalnya, dan siapa pun yang menjawabnya yang menandatangani — nama yang tercatat adalah namanya, bukan pemilik laptop.",
      },
    },
    {
      href: "/procurement/pr",
      title: {
        en: "Approved, and now waiting for money",
        id: "Disetujui, dan kini menunggu uang",
      },
      body: {
        en: "The approved line is not paid. Open it and pay from the line: the ledger row is written from here, with the evidence attached in the same act. Nothing is marked paid because somebody remembers paying it.",
        id: "Baris yang disetujui belum dibayar. Buka dan bayar dari baris itu: baris buku besar ditulis dari sini, dengan bukti dilampirkan sekaligus. Tidak ada yang ditandai lunas hanya karena seseorang ingat sudah membayarnya.",
      },
    },
    {
      href: "/accounting/ledger",
      title: {
        en: "Money out, with proof and detail",
        id: "Uang keluar, dengan bukti dan rincian",
      },
      body: {
        en: "The same payment as a ledger row. A row cannot be posted without at least one nota, transfer proof or photo — and a purchase must say what was bought, how many, at what price, and from whom. Cash position for all five accounts is at the top.",
        id: "Pembayaran yang sama sebagai baris buku besar. Sebuah baris tidak bisa dibukukan tanpa setidaknya satu nota, bukti transfer, atau foto — dan pembelian harus menyebut apa yang dibeli, berapa banyak, dengan harga berapa, dan dari siapa. Posisi kas kelima rekening ada di bagian atas.",
      },
    },
    {
      href: "/procurement/tracker",
      title: {
        en: "What the goods say, against what the money says",
        id: "Apa kata barang, dibanding apa kata uang",
      },
      body: {
        en: "Per supplier: ordered, received, paid, and what they could invoice today. Recording a delivery needs both the photo of the goods and the signed tanda terima, plus who received it and who checked it.",
        id: "Per pemasok: dipesan, diterima, dibayar, dan apa yang bisa mereka tagih hari ini. Mencatat pengiriman membutuhkan foto barang dan tanda terima yang ditandatangani, serta siapa yang menerima dan siapa yang memeriksa.",
      },
    },
    {
      href: "/accounting/verifikasi",
      title: {
        en: "The exception road: bought first, approved later",
        id: "Jalur pengecualian: dibeli dulu, disetujui belakangan",
      },
      body: {
        en: "A photo arrives in Chat for something nobody raised a request for. Five roads out, none of them delete: write the request retro-actively, link it to a row already there, post it as it is, ask a question, or reject it — and rejecting never reaches the ledger.",
        id: "Sebuah foto masuk ke Chat untuk sesuatu yang tidak pernah diminta. Ada lima jalan keluar, tidak satu pun menghapus: tulis permintaannya secara mundur, tautkan ke baris yang sudah ada, bukukan apa adanya, ajukan pertanyaan, atau tolak — dan yang ditolak tidak pernah sampai ke buku besar.",
      },
    },
    {
      href: "/accounting/ringkasan?tab=likuidasi",
      title: {
        en: "Where the last transfer went",
        id: "Ke mana transfer terakhir pergi",
      },
      body: {
        en: "Per transfer, not per month: what was spent before the next one arrived, how many days it lasted, and how much of it went out with no approved line or order behind it.",
        id: "Per transfer, bukan per bulan: apa yang dibelanjakan sebelum transfer berikutnya datang, berapa hari dana itu bertahan, dan berapa banyak yang keluar tanpa baris atau pesanan yang disetujui di belakangnya.",
      },
    },
    {
      href: "/accounting/calendar",
      title: {
        en: "Whether the money lasts the year",
        id: "Apakah uangnya cukup sepanjang tahun",
      },
      body: {
        en: "Twelve months of bills against twelve months of transfers, planned above and actual below. Click a month to open it day by day — the month it runs short and the day it runs short are different questions with different answers.",
        id: "Dua belas bulan tagihan dibanding dua belas bulan transfer, rencana di atas dan realisasi di bawah. Klik satu bulan untuk membukanya per hari — bulan saat uang kurang dan hari saat uang kurang adalah pertanyaan berbeda dengan jawaban berbeda.",
      },
    },
  ],
};

export const TOURS: Record<string, Tour> = { [FLOW_B.id]: FLOW_B };

/** The URL for one step. The tour lives in the query string on purpose: it can
 *  be pasted into a chat, and leaving it is closing a bar rather than escaping
 *  a mode. */
export function tourHref(tour: Tour, index: number): string {
  const step = tour.steps[index];
  const join = step.href.includes("?") ? "&" : "?";
  return `${step.href}${join}tour=${tour.id}&step=${index + 1}`;
}
