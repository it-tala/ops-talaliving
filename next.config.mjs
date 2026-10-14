import path from "node:path";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/* One id per build, so an installed copy can tell it is stale (D328, F24).
   The service worker names its cache after it and imports it from
   `public/sw-version.js`, which is written here and never committed: the
   browser compares that file byte for byte when it checks for an update, so a
   new build is a new worker and the page offers a reload instead of running
   yesterday's code. Kept in the environment because Next evaluates this file
   again in its build workers, and they must agree with the first evaluation. */
if (!process.env.OPS_BUILD_ID) {
  let commit = process.env.WORKERS_CI_COMMIT_SHA || "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { cwd: here, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "local";
    }
  }
  process.env.OPS_BUILD_ID = `${commit.slice(0, 7)}-${Date.now().toString(36)}`;
  writeFileSync(
    path.join(here, "public/sw-version.js"),
    `/* Written by next.config.mjs on every build. Not committed. */\nself.OPS_BUILD_ID = ${JSON.stringify(process.env.OPS_BUILD_ID)};\n`,
  );
}
const buildId = process.env.OPS_BUILD_ID;

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
  generateBuildId: () => buildId,
  /* The same id, readable in the page: a phone tap says which build made it
     (0270, D431), so a fault in one release can be traced to its taps. */
  env: { NEXT_PUBLIC_OPS_BUILD_ID: buildId },
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
