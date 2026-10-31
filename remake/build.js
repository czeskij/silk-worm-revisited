// Unpack your Silkworm ADF into a standalone game:
//
//   node build.js path/to/Silkworm.adf
//
// writes js/gamedata.js (index.html then starts without asking for the disk)
// and dist/Silkworm.html, one file with everything inside that runs from any
// folder or USB stick by double-clicking. Both hold the game's data, so they
// are git-ignored: keep them to yourself.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const adfPath = process.argv[2];
if (!adfPath) { console.error("usage: node build.js path/to/Silkworm.adf"); process.exit(1); }
const here = __dirname;

// run adf.js as the browser would, to unpack with the same code
const sandbox = { window: {}, atob: (s) => Buffer.from(s, "base64").toString("binary") };
sandbox.SW = sandbox.window.SW = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(here, "js/adf.js"), "utf8").replace("window.SW = window.SW || {};", ""), sandbox);
const A = sandbox.SW.adf;

const adf = new Uint8Array(fs.readFileSync(adfPath));
const mem = A.buildMemory(adf);
const problem = A.validate(adf, mem);
if (problem) { console.error(problem); process.exit(1); }
const { game, blocks } = A.unpack(adf, mem);

const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString("base64");
const data = { game: b64(game), blocks: {} };
for (const t in blocks) data.blocks[t] = b64(blocks[t]);
const dataJs = "// Unpacked from your Silkworm ADF by build.js. Don't share or commit.\n" +
  "window.SW = window.SW || {};\nSW.gamedata = " + JSON.stringify(data) + ";\n";
fs.writeFileSync(path.join(here, "js/gamedata.js"), dataJs);

// one-file version: inline every script of index.html
let html = fs.readFileSync(path.join(here, "index.html"), "utf8");
html = html.replace(/<script src="(js\/[^"?]+)(\?[^"]*)?"><\/script>[^\n]*/g, (m, src) => {
  const code = src === "js/gamedata.js" ? dataJs : fs.readFileSync(path.join(here, src), "utf8");
  return "<script>\n" + code.replace(/<\/script/gi, "<\\/script") + "\n</script>";
});
fs.mkdirSync(path.join(here, "dist"), { recursive: true });
fs.writeFileSync(path.join(here, "dist/Silkworm.html"), html);

const kb = (n) => Math.round(n / 1024) + " KB";
console.log("levels' backdrop tracks:", Object.keys(blocks).join(", "));
console.log("js/gamedata.js      ", kb(dataJs.length));
console.log("dist/Silkworm.html  ", kb(html.length));
