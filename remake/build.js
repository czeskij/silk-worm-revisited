// Unpack your Silkworm ADF into a standalone game:
//
//   node build.js path/to/Silkworm.adf
//
// writes js/gamedata.js (index.html runs from it) and dist/Silkworm.html, one
// file with everything inside that runs from any folder or USB stick by
// double-clicking. Both hold the game's data, so they are git-ignored: keep
// them to yourself. Mirrors Research/tools/extract.py and levels.py.
"use strict";
const fs = require("fs"), path = require("path");

const TRACK = 0x1600, LOAD = 0x3FFE0, LEVEL_TRACKS = 0x6B924;
const be16 = (m, a) => (m[a] << 8) | m[a + 1];

// Both loaders pick the head from bit 0 of their track counter, inverted,
// and step the drive every other track: track number 2 reads 3,5,4,7,6,9...
function trackOrder(first, count) {
  let cyl = first >> 1, head = first & 1 ? 0 : 1, w = first;
  const order = [];
  for (let i = 0; i < count; i++) {
    order.push(cyl * 2 + head);
    if (w & 1) { head = 0; w ^= 1; }
    else { head = 1; cyl += 1; w = (w ^ 1) + 2; }
  }
  return order;
}

function tracks(adf, first, count) {
  const out = new Uint8Array(count * TRACK);
  trackOrder(first, count).forEach((t, i) => out.set(adf.subarray(t * TRACK, (t + 1) * TRACK), i * TRACK));
  return out;
}

const adfPath = process.argv[2];
if (!adfPath) { console.error("usage: node build.js path/to/Silkworm.adf"); process.exit(1); }
const here = __dirname;
const adf = new Uint8Array(fs.readFileSync(adfPath));
if (adf.length !== 901120) { console.error("That file isn't an 880 KB ADF disk image."); process.exit(1); }

// chip RAM as the boot block leaves it: 46 tracks from track number 10 at $3FFE0
const mem = new Uint8Array(0x80000);
mem.set(tracks(adf, 10, 46).subarray(0, 0x80000 - LOAD), LOAD);
// entry point $68488 starts with `ori.w #$700,sr`
if (be16(mem, 0x68488) !== 0x007c || be16(mem, 0x6848a) !== 0x0700) {
  console.error("This ADF doesn't match the supported Silkworm disk (the Defjam/CCS release).");
  process.exit(1);
}

// what the remake needs: the program, and the backdrop tracks of each level
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString("base64");
const data = { game: b64(mem.subarray(LOAD)), blocks: {} };
for (let n = 0; n < 16; n++) {
  const t = be16(mem, LEVEL_TRACKS + n * 2);
  if (t < 156 && !(t in data.blocks)) data.blocks[t] = b64(tracks(adf, t, 4));
}
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
console.log("levels' backdrop tracks:", Object.keys(data.blocks).join(", "));
console.log("js/gamedata.js      ", kb(dataJs.length));
console.log("dist/Silkworm.html  ", kb(html.length));
