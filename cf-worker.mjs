// The Worker's entry: the OpenNext build, plus a cron (D382).
//
// `opennextjs-cloudflare build` writes `.open-next/worker.js`, which answers
// every request. This file hands requests straight to it and adds the one
// thing a Next app cannot have on its own: a `scheduled` handler. Every ten
// minutes (`triggers.crons` in wrangler.jsonc) it asks the app's own
// `/api/github/projects/sync` route to write the IT tasks that changed onto
// the GitHub Projects board — called in-process through the same handler, so
// nothing goes out over the network to reach it.
//
// Plain JavaScript on purpose: `.open-next/worker.js` exists only after a
// build, and this file is not part of the TypeScript project.
//
// Nothing happens unless both secrets are set. A preview version (`wrangler
// versions upload`) never runs crons, so only production syncs.
import handler from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(_controller, env, ctx) {
    const secret = env.GITHUB_WEBHOOK_SECRET;
    if (!secret || !env.GITHUB_PROJECTS_TOKEN) return;
    const request = new Request("https://cron.internal/api/github/projects/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    ctx.waitUntil(handler.fetch(request, env, ctx));
  },
};
