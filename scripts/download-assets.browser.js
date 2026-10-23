// Run in the browser console on any https://irp.cdn-website.com/ tab (e.g. open one image URL first).
// Fetches every URL in build-assets.json (pasted below as URLS), packs them into one
// store-only zip (+ manifest.json mapping url -> file) and downloads "nsea-build-assets.zip".
(async () => {
  const URLS = /*__URLS__*/[];
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder();
  const used = new Set(), manifest = {}, failed = [], files = [];
  const nameFor = (u) => {
    const p = new URL(u).pathname.split('/').filter(Boolean);
    let n = decodeURIComponent(p[p.length - 1]).replace(/[^\w.\-]+/g, '_');
    if (used.has(n)) n = (p[p.length - 2] || 'x') + '_' + n;
    while (used.has(n)) n = '_' + n;
    used.add(n); return n;
  };
  let done = 0;
  const queue = URLS.slice();
  const worker = async () => {
    for (let u; (u = queue.shift());) {
      try {
        const r = await fetch(u, { credentials: 'omit' });
        if (!r.ok) throw new Error(r.status);
        const buf = new Uint8Array(await r.arrayBuffer());
        const n = nameFor(u); manifest[u] = n; files.push({ n, buf });
      } catch (e) { failed.push(u + ' ' + e.message); }
      if (++done % 20 === 0) console.log(done + '/' + URLS.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  files.push({ n: 'manifest.json', buf: enc.encode(JSON.stringify({ manifest, failed }, null, 1)) });
  const parts = [], central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const nb = enc.encode(f.n), c = crc(f.buf);
    const lh = new Uint8Array([0x50,0x4b,3,4, ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(f.buf.length), ...u32(f.buf.length), ...u16(nb.length), ...u16(0)]);
    parts.push(lh, nb, f.buf);
    central.push(new Uint8Array([0x50,0x4b,1,2, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(f.buf.length), ...u32(f.buf.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += lh.length + nb.length + f.buf.length;
  }
  const csz = central.reduce((s, b) => s + b.length, 0);
  const end = new Uint8Array([0x50,0x4b,5,6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csz), ...u32(off), ...u16(0)]);
  const blob = new Blob([...parts, ...central, end], { type: 'application/zip' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nsea-build-assets.zip';
  document.body.appendChild(a); a.click();
  console.log('Done. ' + files.length + ' files (' + (blob.size / 1e6).toFixed(1) + ' MB), failed: ' + failed.length, failed);
})();
