import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** ESLint, flat config (Next 16 dropped `next lint` and ESLint 8, F292).
 *
 *  The same rules `.eslintrc.json` held, carried over as they were:
 *  Next's core-web-vitals set, and the service boundary (ADR-004) — services
 *  may not import each other; screens, the demo and the shared libraries are
 *  clients of every service and are exempt, as is each service's contracts
 *  file. */
const SERVICES = [
  "@/services/identity/*",
  "@/services/procurement/*",
  "@/services/accounting/*",
  "@/services/documents/*",
  "@/services/events/*",
  "@/services/hr/*",
  "@/services/production/*",
  "@/services/inventory/*",
  "@/services/marketing/*",
  "@/services/delivery/*",
  "@/services/assistant/*",
];

const config = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "public/**",
      "next-env.d.ts",
      "docs/**",
      "supabase/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      /* eslint-plugin-react-hooks 7 (with eslint-config-next 16) adds the
       * React Compiler rules. The code was written against 5, whose two rules
       * — rules-of-hooks and exhaustive-deps — stay on. These five flagged 100
       * existing places on the upgrade (70 of them a setState in an effect
       * that loads data); adopting them is its own piece of work, on the
       * backlog, not a side effect of moving the toolchain (F292). */
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "no-restricted-imports": ["error", {
        patterns: [{
          group: SERVICES,
          message: "Services may not import each other. Cross-service data goes through the service's own API (ADR-004). This rule does not apply to screens or to src/demo, which are clients of every service.",
        }],
      }],
    },
  },
  {
    files: ["src/app/**", "src/components/**", "src/demo/**", "src/lib/**", "src/store/**", "src/services/*/contracts.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
