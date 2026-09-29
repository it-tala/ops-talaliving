import {
  Coins,
  BellRing, FileSignature,
  LayoutDashboard, Users, CalendarCheck, MapPin, FileBadge, Wallet,
  ShoppingCart, ClipboardList, FileText, PackageCheck, Boxes, TreePine,
  Landmark, BookOpen, TrendingUp, PiggyBank, Receipt,
  Megaphone, UserRound, Target, HandCoins, MessageSquare,
  FolderKanban, Hammer, Truck, Wrench, Stamp, Package,
  PencilRuler, ListTree, ListChecks, CalendarClock, CalendarRange, Link2,
  Cpu, ScrollText, Activity, UserCog, KeyRound, HardDrive, Clock, Scale, Factory,
  Settings, FlaskConical, MessagesSquare, Route, ShieldCheck, Gauge, MessageSquareOff, Database, Ruler, FolderTree, Tags, MonitorSmartphone, Building2, type LucideIcon,
} from "lucide-react";

/** Menu sebagai DATA, bukan JSX.
 *
 *  Sidebar hanya membaca berkas ini dan menyaringnya dengan `can(permission)`.
 *  Konsekuensi yang disengaja: menu yang tidak diizinkan TIDAK dirender sama
 *  sekali — bukan ditampilkan lalu di-disable, dan bukan disembunyikan CSS.
 *  Menambah halaman berarti menambah satu baris di sini, bukan menyunting
 *  komponen navigasi.
 */
export interface NavItem {
  /** The English default, kept as the fallback and as what the code reads
   *  like. `labelKey` overrides it once a translation exists (D224). */
  label: string;
  /** Path into `MESSAGES.nav`. Absent means the label is a proper noun or has
   *  no translation yet, and it renders as written — which is honest, and
   *  visible, rather than a silent English string dressed as a translation. */
  labelKey?: keyof typeof import("./messages").MESSAGES["nav"];
  href: string;
  icon: LucideIcon;
  permission?: string;
  /** A second permission that also opens the item. Exactly one screen needs
   *  this and it is not an accident: the pay-rule book is **read** by HRD and
   *  **changed** by IT (owner, D193), so gating it on either alone would hide
   *  it from half the people who need it. An IT account with no payroll grant
   *  is a normal account, and it must still be able to reach the rules it is
   *  the only one allowed to change. */
  orPermission?: string;
  /** An authority that also opens the item. Leadership decides overtime by
   *  the `approve_overtime` authority and usually holds no HR module, so the
   *  one screen where overtime is decided has to be reachable by it (D333). */
  orAuthority?: import("@/services/identity/contracts").Authority;
  badge?: "core" | "new";
}

export interface NavSection {
  title: string;
  titleKey?: keyof typeof import("./messages").MESSAGES["nav"];
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Dashboard",
    titleKey: "dashboard",
    icon: LayoutDashboard,
    items: [
      { label: "Overview", labelKey: "overview", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.read" },
    ],
  },
  {
    title: "HR",
    titleKey: "hr",
    icon: Users,
    items: [
      { label: "Employees", labelKey: "employees", href: "/hrd/karyawan", icon: Users, permission: "hrd.read", badge: "core" },
      { label: "Work schedules", labelKey: "workSchedules", href: "/hrd/jadwal", icon: CalendarClock, permission: "hrd.read", badge: "new" },
      { label: "Attendance", labelKey: "attendance", href: "/hrd/absensi", icon: CalendarCheck, permission: "hrd.read" },
      { label: "Attendance by location", labelKey: "locatedTaps", href: "/hrd/absensi/lokasi", icon: MapPin, permission: "hrd.read", badge: "new" },
      { label: "Overtime", labelKey: "overtime", href: "/hrd/lembur", icon: Clock, permission: "hrd.read", orAuthority: "approve_overtime", badge: "new" },
      { label: "Employee Files", labelKey: "employeeFiles", href: "/hrd/berkas-201", icon: FileBadge, permission: "hrd.read", badge: "new" },
      { label: "Employment contracts", labelKey: "contracts", href: "/hrd/kontrak", icon: ScrollText, permission: "hrd.read", badge: "new" },
      { label: "Leave & Permits", labelKey: "leave", href: "/hrd/cuti", icon: CalendarClock, permission: "hrd.read", badge: "new" },
      { label: "Payroll", labelKey: "payroll", href: "/hrd/payroll", icon: Wallet, permission: "payroll.read" },
      { label: "Gajian mingguan", labelKey: "payrollWeek", href: "/hrd/payroll/minggu", icon: CalendarRange, permission: "payroll.read", badge: "new" },
      { label: "Statutory contributions", labelKey: "contributions", href: "/hrd/iuran", icon: ShieldCheck, permission: "payroll.read", orPermission: "accounting.read", badge: "new" },
      { label: "Task monitoring", labelKey: "taskMonitoring", href: "/hrd/tugas", icon: ListChecks, permission: "hrd.read", badge: "new" },
      { label: "Wajib Lapor (WLKP)", labelKey: "wlkp", href: "/hrd/wlkp", icon: ClipboardList, permission: "hrd.read", orPermission: "payroll.read", badge: "new" },
      { label: "Performance & tasks", labelKey: "performance", href: "/hrd/kinerja", icon: Gauge, permission: "payroll.read", orPermission: "hrd.read", badge: "new" },
      /* Under Payroll, not under IT. Its gate has always been `payroll.read`
       * — HRD owns the rule book — and once the IT heading means "IT and
       * leadership only" (owner, Q22), a payroll screen sitting inside it
       * made the heading say something untrue. Nobody gained or lost
       * access; the route is unchanged (D190). */
      { label: "Aturan penggajian", labelKey: "payRules", href: "/it/aturan-gaji", icon: Scale, permission: "payroll.read", orPermission: "it.update", badge: "new" },
    ],
  },
  {
    title: "Procurement",
    titleKey: "procurement",
    icon: ShoppingCart,
    items: [
      { label: "Requests", labelKey: "requests", href: "/procurement/pr", icon: ClipboardList, permission: "procurement.read", badge: "core" },
      { label: "Meeting board", labelKey: "meetingBoard", href: "/procurement/meeting", icon: Users, permission: "procurement.read" },
      { label: "Payment rounds", labelKey: "rounds", href: "/procurement/rounds", icon: HandCoins, permission: "procurement.read" },
      { label: "Purchase Tracker", labelKey: "purchaseTracker", href: "/procurement/tracker", icon: Route, permission: "procurement.read", badge: "new" },
      { label: "Purchase Order", labelKey: "purchaseOrder", href: "/procurement/po", icon: FileText, permission: "procurement.read" },
      { label: "Receiving Report", labelKey: "receivingReport", href: "/procurement/penerimaan", icon: PackageCheck, permission: "procurement.read" },
    ],
  },
  {
    title: "Inventory",
    titleKey: "inventory",
    icon: Boxes,
    items: [
      /* One entry, not two. Logs and boards are the same wood either side of
       * the saw, and the board rack only became stock at all once usage was
       * recorded (D202, D203). */
      { label: "Timber", labelKey: "timber", href: "/inventory/log", icon: TreePine, permission: "inventory.read", badge: "core" },
      { label: "Materials & Hardware", labelKey: "materials", href: "/inventory/material", icon: Boxes, permission: "inventory.read", badge: "new" },
      { label: "Finished Goods", labelKey: "finishedGoods", href: "/inventory/produk", icon: PackageCheck, permission: "inventory.read", badge: "new" },
      { label: "Stock Adjustments", labelKey: "adjustments", href: "/inventory/penyesuaian", icon: Wrench, permission: "inventory.adjust", badge: "new" },
      { label: "Assets", labelKey: "assets", href: "/inventory/assets", icon: MonitorSmartphone, permission: "inventory.read", badge: "new" },
      /* Labels for what was recorded: materials, assets, finished goods (D321). */
      { label: "Labels", labelKey: "labels", href: "/inventory/label", icon: Tags, permission: "inventory.read", badge: "new" },
    ],
  },
  {
    title: "Accounting",
    titleKey: "accounting",
    icon: Landmark,
    items: [
      { label: "Rekening koran", labelKey: "statements", href: "/accounting/rekening-koran", icon: Landmark, permission: "accounting.read", badge: "new" },
      { label: "Ledger", labelKey: "ledger", href: "/accounting/ledger", icon: BookOpen, permission: "accounting.read", badge: "core" },
      { label: "Liquidation", labelKey: "liquidation", href: "/accounting/liquidation", icon: TrendingUp, permission: "accounting.read", badge: "new" },
      { label: "Payment Calendar", labelKey: "calendar", href: "/accounting/calendar", icon: PiggyBank, permission: "accounting.read", badge: "new" },
      { label: "Monthly bills", labelKey: "monthlyBills", href: "/accounting/tagihan", icon: CalendarClock, permission: "accounting.read", badge: "new" },
      { label: "Documents", labelKey: "documents", href: "/accounting/documents", icon: FileBadge, permission: "accounting.read" },
      { label: "Purchase Verification", labelKey: "verification", href: "/accounting/verifikasi", icon: Receipt, permission: "accounting.read", badge: "core" },
    ],
  },
  {
    /* Its own heading, not a corner of Inventory: suppliers are procurement's
     * and accounting's, items are everybody's, units are on every line. Each
     * page is still gated by the module that owns the data (owner,
     * 2026-09-23) — no separate master-data role. */
    title: "Master Data",
    titleKey: "masterData",
    icon: Database,
    items: [
      { label: "Suppliers", labelKey: "suppliers", href: "/master-data/suppliers", icon: Truck, permission: "procurement.read" },
      { label: "Items", labelKey: "items", href: "/master-data/items", icon: Boxes, permission: "procurement.read" },
      { label: "Item categories", labelKey: "itemCategories", href: "/master-data/categories", icon: FolderTree, permission: "procurement.read" },
      { label: "Units", labelKey: "units", href: "/master-data/units", icon: Ruler, permission: "procurement.read" },
      { label: "Accounts", labelKey: "accounts", href: "/master-data/accounts", icon: Landmark, permission: "accounting.read", badge: "new" },
      { label: "Transaction types", labelKey: "transactionTypes", href: "/master-data/transaction-types", icon: Tags, permission: "accounting.read", badge: "new" },
      { label: "Asset categories", labelKey: "assetCategories", href: "/master-data/asset-categories", icon: MonitorSmartphone, permission: "inventory.read", badge: "new" },
      { label: "Clients", labelKey: "clients", href: "/master-data/clients", icon: Building2, permission: "project.read", badge: "new" },
    ],
  },
  {
    title: "Marketing",
    titleKey: "marketing",
    icon: Megaphone,
    items: [
      { label: "Package — pipeline", labelKey: "pipeline", href: "/marketing/pipeline", icon: Target, permission: "marketing.read", badge: "new" },
      { label: "Representative & komisi", labelKey: "reps", href: "/marketing/agen", icon: HandCoins, permission: "marketing.read", badge: "new" },
    ],
  },
  {
    title: "Projects",
    titleKey: "projects",
    icon: FolderKanban,
    items: [
      { label: "Projects", labelKey: "orders", href: "/proyek/order", icon: FolderKanban, permission: "project.read", badge: "core" },
      { label: "Quotations", labelKey: "quotations", href: "/proyek/quotation", icon: FileSignature, permission: "project.read", badge: "new" },
      { label: "Client follow-ups", labelKey: "followUps", href: "/proyek/follow-up", icon: BellRing, permission: "project.read", badge: "new" },
      { label: "Cost vs projection", labelKey: "costVsPlan", href: "/proyek/produksi", icon: Scale, permission: "project.read", badge: "new" },
      { label: "Delivery", labelKey: "delivery", href: "/proyek/pengiriman", icon: Truck, permission: "project.read", orPermission: "delivery.read", badge: "new" },
      { label: "Packing boxes & labels", labelKey: "boxes", href: "/proyek/peti", icon: Package, permission: "project.read", orPermission: "delivery.read", badge: "new" },
      { label: "Installation", labelKey: "installation", href: "/proyek/instalasi", icon: Wrench, permission: "project.read", orPermission: "delivery.read", badge: "new" },
      /* Readable by anyone on the project; signing needs `project.handover`,
       * which the screen gates separately (D211). */
      { label: "Handover", labelKey: "handover", href: "/proyek/serah-terima", icon: Stamp, permission: "project.read", orPermission: "delivery.read", badge: "new" },
    ],
  },
  {
    title: "Production",
    titleKey: "production",
    icon: Hammer,
    items: [
      { label: "Design", labelKey: "design", href: "/produksi/desain", icon: PencilRuler, permission: "production.read", badge: "new" },
      { label: "Who did the work", labelKey: "workAttribution", href: "/produksi/penautan", icon: Link2, permission: "production.read", badge: "new" },
      { label: "Goods at vendors", labelKey: "vendorWork", href: "/produksi/vendor", icon: Factory, permission: "production.read", badge: "new" },
      { label: "Products & BOM", labelKey: "bom", href: "/produksi/bom", icon: ListTree, permission: "production.read", badge: "core" },
      { label: "BOM rates", labelKey: "bomRates", href: "/produksi/rate", icon: Coins, permission: "production.read", badge: "new" },
      { label: "Job Orders", labelKey: "schedule", href: "/produksi/jadwal", icon: CalendarClock, permission: "production.read", badge: "new" },
      { label: "Job trail", labelKey: "jobTrail", href: "/produksi/jejak", icon: Route, permission: "production.read", badge: "new" },
    ],
  },
  {
    title: "John Lau",
    titleKey: "johnLau",
    icon: MessageSquare,
    items: [
      /* Readable by anyone who can open anything: the page is the boundary,
         and a boundary nobody can read is a boundary nobody can check. */
      { label: "Apa yang boleh ditanyakan", labelKey: "johnLauScope", href: "/john-lau", icon: MessageSquare, permission: "dashboard.read", badge: "new" },
    ],
  },
  {
    title: "IT",
    titleKey: "it",
    icon: Cpu,
    items: [
      { label: "Audit Log", labelKey: "audit", href: "/it/audit", icon: ScrollText, permission: "it.read", badge: "new" },
      /* The tuning list. `it.read` because it is everybody's prompts in one
         place — which is also why it shows no names, and why the two functions
         behind it pick their own columns rather than leaning on RLS. */
      { label: "John Lau — tidak dimengerti", labelKey: "johnLauTuning", href: "/it/john-lau", icon: MessageSquareOff, permission: "it.read", badge: "new" },
      { label: "Activity Log", labelKey: "activity", href: "/it/aktivitas", icon: Activity, permission: "it.read", badge: "new" },
      { label: "Users", labelKey: "users", href: "/it/pengguna", icon: UserCog, permission: "it.manage_users", badge: "new" },
      { label: "Roles & Permissions", labelKey: "roles", href: "/it/peran", icon: KeyRound, permission: "it.manage_roles", badge: "new" },
      /* Whether uploads can reach each shared drive's OPS folder (F173).
         `it.read` to look; the one write on it asks `it.manage_drives`. */
      { label: "Google Drive", labelKey: "googleDrive", href: "/it/drive", icon: HardDrive, permission: "it.read", badge: "new" },
    ],
  },
  {
    /* M1 only. Goes when the screens it stands in for exist. */
    title: "Demo",
    titleKey: "demo",
    icon: FlaskConical,
    items: [
      { label: "Diagnostics", labelKey: "diagnostics", href: "/demo", icon: FlaskConical, permission: "dashboard.read", badge: "new" },
      { label: "Google Chat (simulated)", labelKey: "chatSimulated", href: "/demo/chat", icon: MessagesSquare, permission: "dashboard.read" },
    ],
  },
  {
    title: "Settings",
    titleKey: "settings",
    icon: Settings,
    items: [
      { label: "General", labelKey: "general", href: "/pengaturan", icon: Settings, permission: "settings.read", badge: "new" },
    ],
  },
];
