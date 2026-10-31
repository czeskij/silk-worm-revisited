// Read Silkworm's data straight from the player's ADF.
// Mirrors Research/tools/extract.py and levels.py; addresses are documented
// in Research/NOTES.md.
"use strict";
window.SW = window.SW || {};

SW.adf = (function () {
  const TRACK = 0x1600;

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

  // Chip RAM as the boot block leaves it: 46 tracks from track number 10 at $3FFE0.
  function buildMemory(adf) {
    const mem = new Uint8Array(0x80000);
    const game = tracks(adf, 10, 46);
    mem.set(game.subarray(0, 0x80000 - 0x3FFE0), 0x3FFE0);
    return mem;
  }

  const be16 = (m, a) => (m[a] << 8) | m[a + 1];
  const bes16 = (m, a) => (be16(m, a) << 16) >> 16;
  const be32 = (m, a) => ((m[a] << 24) | (m[a + 1] << 16) | (m[a + 2] << 8) | m[a + 3]) >>> 0;

  function validate(adf, mem) {
    if (adf.length !== 901120) return "That file isn't an 880 KB ADF disk image.";
    // entry point $68488 starts with `ori.w #$700,sr`
    if (be16(mem, 0x68488) !== 0x007c || be16(mem, 0x6848a) !== 0x0700)
      return "This ADF doesn't match the supported Silkworm disk (the Defjam/CCS release). " +
             "Other releases load differently and aren't supported yet.";
    return null;
  }

  // Everything the remake needs from the disk: the loaded game ($3FFE0 up) and
  // the backdrop tracks of each level (table $6B924). build.js stores this in
  // js/gamedata.js so the game starts without the ADF.
  const LOAD = 0x3FFE0, LEVEL_TRACKS = 0x6B924;
  function unpack(adf, mem) {
    const blocks = {};
    for (let n = 0; n < 16; n++) {
      const t = be16(mem, LEVEL_TRACKS + n * 2);
      if (t < 156 && !(t in blocks)) blocks[t] = tracks(adf, t, 4);
    }
    return { game: mem.subarray(LOAD), blocks };
  }
  function blockReader(adf) { return (t) => tracks(adf, t, 4); }

  // ...and back: SW.gamedata holds base64 strings
  function fromBase64(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function loadBundle(data) {
    const mem = new Uint8Array(0x80000);
    mem.set(fromBase64(data.game), LOAD);
    const blocks = {};
    for (const t in data.blocks) blocks[t] = fromBase64(data.blocks[t]);
    return { mem, blocks: (t) => blocks[t] };
  }

  return { TRACK, trackOrder, tracks, buildMemory, validate, unpack, blockReader, loadBundle, be16, bes16, be32 };
})();

// Keep the ADF in IndexedDB so it only has to be picked once per browser.
SW.store = (function () {
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("silkworm-revisited", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function put(key, value) {
    try {
      const d = await db();
      await new Promise((res, rej) => {
        const tx = d.transaction("files", "readwrite");
        tx.objectStore("files").put(value, key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* storage unavailable: fine, just ask again next time */ }
  }
  async function get(key) {
    try {
      const d = await db();
      return await new Promise((res, rej) => {
        const r = d.transaction("files").objectStore("files").get(key);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    } catch (e) { return undefined; }
  }
  return { put, get };
})();
