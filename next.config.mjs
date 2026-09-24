import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/* A build pointed at the database ships no demo. `isRealApi()` asks the same
   three things at runtime; asking them here too means a live bundle never
   carries the fixtures, the demo store or a second implementation of every
   service — about a fifth of what every screen used to download. A demo
   build (no flag, or no keys) is untouched. */
const liveBuild =
  process.env.NEXT_PUBLIC_USE_SUPABASE === "1"
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { webpack }) {
    if (liveBuild) {
      /* By the import as written, not by resolved path: the demo's own files
         import `./store` relatively and keep the real one, and only the three
         doors the rest of the app uses are swapped. A replacement rather than
         `resolve.alias`, because Next resolves `@/` through tsconfig paths
         before an alias is ever consulted. */
      const swapTo = {
        "@/demo/api": "src/live/api.ts",
        "@/demo/provider": "src/live/provider.tsx",
        "@/demo/store": "src/live/store.ts",
      };
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^@\/demo\/(api|provider|store)$/, (resource) => {
          resource.request = path.join(here, swapTo[resource.request]);
        }),
      );
    }
    return config;
  },
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
