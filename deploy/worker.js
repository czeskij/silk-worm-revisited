// Serves the remake behind a password (HTTP basic auth).
//
// The code comes from ../remake as static assets; the game data
// (js/gamedata.js, unpacked from your ADF) lives in the private KV namespace
// GAMEDATA and is never in the repo. Every request, assets included, goes
// through this check first (run_worker_first in wrangler.jsonc).
//
// AUTH_USER is a plain variable in wrangler.jsonc; AUTH_PASSWORD is a secret
// (`npx wrangler secret put AUTH_PASSWORD`). Without it nothing is served.

const DATA_PATH = "/js/gamedata.js";

export default {
  async fetch(request, env) {
    if (!env.AUTH_PASSWORD) return text("Not set up yet: set the AUTH_PASSWORD secret.", 503);
    if (!(await authorized(request, env))) {
      return text("Password required.", 401, { "WWW-Authenticate": 'Basic realm="Silkworm", charset="UTF-8"' });
    }

    if (new URL(request.url).pathname === DATA_PATH) {
      const data = await env.GAMEDATA.get("gamedata.js");
      // without data the page shows how to build it (SW.gamedata stays undefined)
      if (!data) return text("// game data not uploaded yet\n", 404, { "Content-Type": "text/javascript; charset=utf-8" });
      return new Response(data, {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "private, no-cache" },
      });
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-cache");   // never in shared caches
    return out;
  },
};

async function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch (e) { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  const user = decoded.slice(0, i), pass = decoded.slice(i + 1);
  // compare digests in constant time, so the check leaks nothing through timing
  const [a, b] = await Promise.all([digest(`${user}:${pass}`), digest(`${env.AUTH_USER || "silkworm"}:${env.AUTH_PASSWORD}`)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function digest(s) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

function text(body, status, headers) {
  return new Response(body, {
    status,
    headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, headers),
  });
}
