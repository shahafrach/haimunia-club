// Q-56: images, fonts and icons are cached for a year (_headers: immutable) and across releases (sw.js
// STATIC_CACHE keeps a copy once it has one). That is only safe if a file never changes under the same name:
// a member would keep the old bytes forever. So every static file's hash is pinned here.
//   Changed a picture? Give it a new name and update the references.
//   Added one? Add it to test/fixtures/static-assets.json (sha256, first 16 hex) and to sw.js OPTIONAL_ASSETS.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const pinned = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/static-assets.json"), "utf8"));
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const onDisk = [...walk("assets"), ...fs.readdirSync(root).filter((f) => /^icon-.*\.png$|^apple-touch-icon\.png$/.test(f))].sort();
const hash = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex").slice(0, 16);

test("no static file changed in place (a changed picture gets a new name)", () => {
  for (const f of onDisk) if (pinned[f]) assert.equal(hash(f), pinned[f], `${f} changed but kept its name: members keep the old copy. Rename it.`);
});
test("every static file is pinned, and every pinned file exists", () => {
  for (const f of onDisk) assert.ok(pinned[f], `${f} is new: add its hash to test/fixtures/static-assets.json`);
  for (const f of Object.keys(pinned)) assert.ok(onDisk.includes(f), `${f} is pinned but gone: remove it from the fixture`);
});
test("_headers marks the static files immutable, and never the page or the worker", () => {
  const h = fs.readFileSync(path.join(root, "_headers"), "utf8");
  for (const p of ["/assets/*", "/icon-*", "/apple-touch-icon.png"]) assert.match(h, new RegExp(`^${p.replace(/[*.]/g, "\\$&")}\\n  Cache-Control: public, max-age=31536000, immutable$`, "m"), p);
  for (const p of ["/", "/index.html", "/sw.js"]) assert.match(h, new RegExp(`^${p.replace(/[.]/g, "\\.")}\\n  Cache-Control: no-cache$`, "m"), p);
});
test("sw.js: static files in a long-lived cache outside the versioned prefix; code stays versioned", () => {
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(sw, /const STATIC_CACHE = "haimunia-static";/);
  assert.ok(!"haimunia-static".startsWith(sw.match(/const CACHE_PREFIX = "([^"]+)";/)[1]), "activate would delete it");
  assert.match(sw, /if \(await statics\.match\(new URL\(url, self\.location\)\.href\)\) return;/, "install skips what it already has");
});
