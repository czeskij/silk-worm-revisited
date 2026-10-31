// First-time setup of the Cloudflare Worker, run from this folder:
//
//   npm install
//   node setup.js
//
// 1. creates the private KV namespace for the game data (once) and writes its
//    id into wrangler.jsonc (commit that change)
// 2. deploys the Worker
// 3. uploads ../remake/js/gamedata.js (run `node ../remake/build.js <adf>` first)
// 4. asks you for the site password (stored as the AUTH_PASSWORD secret)
//
// Wrangler opens a browser to log in to Cloudflare the first time.
// Later: `node setup.js --data` uploads the game data again, nothing else.
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");

const here = __dirname;
const config = path.join(here, "wrangler.jsonc");
const data = path.join(here, "../remake/js/gamedata.js");
const wrangler = (args, opts) =>
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", ...args],
               Object.assign({ cwd: here, stdio: "inherit" }, opts));

if (!fs.existsSync(data)) {
  console.error("No game data yet: run `node ../remake/build.js path/to/Silkworm.adf` first.");
  process.exit(1);
}
const uploadData = () =>
  wrangler(["kv", "key", "put", "gamedata.js", "--path", data, "--binding", "GAMEDATA", "--remote"]);

if (process.argv.includes("--data")) { uploadData(); process.exit(0); }

let cfg = fs.readFileSync(config, "utf8");
if (cfg.includes("SET_BY_SETUP")) {
  console.log("Creating the KV namespace for the game data...");
  const out = wrangler(["kv", "namespace", "create", "GAMEDATA"], { stdio: ["inherit", "pipe", "inherit"] }).toString();
  process.stdout.write(out);
  const id = (out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/) || [])[1];
  if (!id) { console.error("Couldn't read the namespace id above; put it in wrangler.jsonc by hand."); process.exit(1); }
  cfg = cfg.replace("SET_BY_SETUP", id);
  fs.writeFileSync(config, cfg);
  console.log(`wrangler.jsonc now uses namespace ${id}: commit and push that change.`);
}

wrangler(["deploy"]);
uploadData();
console.log("\nChoose the password for the site (user name: silkworm).");
wrangler(["secret", "put", "AUTH_PASSWORD"]);
console.log("\nDone. Open the workers.dev address printed by the deploy above.");
