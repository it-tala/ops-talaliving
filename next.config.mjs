/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Prototype: jangan blokir build karena lint. Type-safety dijaga via `tsc`.
    ignoreDuringBuilds: true,
  },
  // Suppliers and the item catalogue moved under Master Data (owner,
  // 2026-09-23). Bookmarks and links pasted into chat keep working.
  async redirects() {
    return [
      { source: "/procurement/supplier", destination: "/master-data/suppliers", permanent: false },
      { source: "/procurement/catalog", destination: "/master-data/items", permanent: false },
    ];
  },
};

export default nextConfig;
