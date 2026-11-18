// Q-35: the home-screen icons are full-bleed. icon-192.png and icon-512.png were a rounded navy tile on a
// WHITE square, and apple-touch-icon pointed at icon-192.png, so iOS drew white corners round the app icon
// (owner's screenshot, 2026-11-18). The maskable pair carried a white square inside a navy frame.
//
// This reads every PNG the manifest and the pages name as an app icon (a small decoder over node:zlib,
// no dependency) and fails on a near-white pixel anywhere on the outer edge, which is where a white
// square or a rounded tile on white shows.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import zlib from "node:zlib";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));

/** Decode an 8-bit RGB/RGBA/grey PNG (non-interlaced) into { width, height, channels, pixel(x, y) }. */
function decodePng(buf) {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  let off = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  assert.equal(depth, 8, "8-bit PNG");
  assert.equal(interlace, 0, "not interlaced");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  assert.ok(channels, `colour type ${colorType} is not palette-free RGB/RGBA/grey`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  const pixel = (x, y) => {
    const i = y * stride + x * channels;
    if (channels <= 2) return [out[i], out[i], out[i], channels === 2 ? out[i + 1] : 255];
    return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255];
  };
  return { width, height, channels, pixel };
}

const manifest = JSON.parse(read("manifest.json").toString("utf8"));
const html = read("index.html").toString("utf8");
const iconFiles = new Set([
  ...manifest.icons.map((i) => i.src),
  ...(manifest.shortcuts || []).flatMap((s) => (s.icons || []).map((i) => i.src)),
  ...[...html.matchAll(/<link rel="(?:apple-touch-icon|icon)" href="\.\/([^"]+)"/g)].map((m) => m[1]),
]);

test("the decoder reads the files it checks", () => {
  assert.ok(iconFiles.size >= 5, `icons found: ${[...iconFiles].join(", ")}`);
  for (const f of iconFiles) {
    const png = decodePng(read(f));
    assert.ok(png.width > 0 && png.width === png.height, `${f} is square`);
  }
});

test("no app icon has a near-white or transparent pixel on its outer edge (no white rim on a home screen)", () => {
  for (const f of iconFiles) {
    const { width: w, height: h, pixel } = decodePng(read(f));
    const edge = [];
    for (let x = 0; x < w; x++) edge.push([x, 0], [x, h - 1]);
    for (let y = 0; y < h; y++) edge.push([0, y], [w - 1, y]);
    for (const [x, y] of edge) {
      const [r, g, b, a] = pixel(x, y);
      assert.ok(Math.min(r, g, b) < 200, `${f}: near-white pixel (${r},${g},${b}) at ${x},${y}`);
      assert.equal(a, 255, `${f}: transparent pixel at ${x},${y} (iOS fills it with black or white)`);
    }
  }
});

test("each manifest icon is the size it declares", () => {
  for (const i of manifest.icons) {
    const { width, height } = decodePng(read(i.src));
    assert.equal(`${width}x${height}`, i.sizes, i.src);
  }
});

test("apple-touch-icon is its own 180x180 file, precached, and the icon links name files that exist", () => {
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png" \/>/);
  const { width, height } = decodePng(read("apple-touch-icon.png"));
  assert.equal(`${width}x${height}`, "180x180");
  const sw = read("sw.js").toString("utf8");
  for (const f of iconFiles) {
    assert.ok(fs.existsSync(new URL(f, root)), `${f} exists`);
    assert.ok(sw.includes(`"./${f}"`), `${f} is in the sw.js precache lists`);
  }
});
