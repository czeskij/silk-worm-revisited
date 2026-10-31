// The game's data, unpacked from the ADF by build.js into js/gamedata.js:
// the loaded program ($3FFE0 up) and each level's backdrop tracks.
// Addresses used by the other scripts are documented in Research/NOTES.md.
"use strict";
window.SW = window.SW || {};

SW.data = (function () {
  const LOAD = 0x3FFE0;

  const be16 = (m, a) => (m[a] << 8) | m[a + 1];
  const bes16 = (m, a) => (be16(m, a) << 16) >> 16;
  const be32 = (m, a) => ((m[a] << 24) | (m[a + 1] << 16) | (m[a + 2] << 8) | m[a + 3]) >>> 0;

  function fromBase64(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // -> { mem: 512 KB chip RAM as the game sees it, blocks(track): backdrop block }
  function load(data) {
    const mem = new Uint8Array(0x80000);
    mem.set(fromBase64(data.game), LOAD);
    const blocks = {};
    for (const t in data.blocks) blocks[t] = fromBase64(data.blocks[t]);
    return { mem, blocks: (t) => blocks[t] };
  }

  return { load, be16, bes16, be32 };
})();
