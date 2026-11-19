// Q-56: boot reads the settings store once (getAll) instead of one get per setting; the few gets left are
// later, unrelated reads. Stored values still arrive: the upgrade tests (upgrade-in-place, a v2.34.0 phone)
// boot with a member's real settings through the same path.
import { test } from "node:test";
import assert from "node:assert";
import { IDBObjectStore as FakeStore } from "fake-indexeddb";
import { bootApp } from "./helpers/boot.mjs";

test("boot reads settings in one getAll, not twelve gets", async () => {
  const c = { get: 0, getAll: 0 };
  const P = FakeStore.prototype, get = P.get, getAll = P.getAll;
  P.get = function (...a) { if (this.name === "settings") c.get++; return get.apply(this, a); };
  P.getAll = function (...a) { if (this.name === "settings") c.getAll++; return getAll.apply(this, a); };
  try { await bootApp(); } finally { P.get = get; P.getAll = getAll; }
  assert.equal(c.getAll, 1, "one snapshot of the settings store");
  assert.ok(c.get <= 4, `${c.get} single reads at boot (was 15)`);
});

// Q-56: the first paint is the רישום photo and title, from index.html alone (LCP was the photo painted after
// app.js). Photo-sized, not full screen: a full-viewport picture does not count as content.
import fs from "node:fs";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
test("the boot splash carries the רישום photo and title; the photo and the title face are preloaded", () => {
  assert.match(html, /<div id="loading" class="boot-splash" role="status" aria-live="polite">\s*<!--[\s\S]*?-->\s*<div class="boot-photo" aria-hidden="true">\s*<div class="boot-title">רישום אימון<\/div>/);
  assert.match(html, /\.boot-photo\{ align-self:stretch; height:clamp\(360px, 58svh, 520px\);/);
  assert.match(html, /<link rel="preload" href="\.\/assets\/club-photos\/add-stripe-wall\.webp" as="image" type="image\/webp" fetchpriority="high" \/>/);
  assert.match(html, /<link rel="preload" href="\.\/assets\/fonts\/secularone-400-hebrew\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
  assert.ok(html.indexOf('rel="preload"') < html.indexOf('<script defer'), "preloads come before the app scripts");
});
test("scene photos are WebP where image-set() type() is understood, JPEG otherwise", () => {
  assert.match(html, /@supports \(background-image: image-set\(url\('\.\/x\.webp'\) type\('image\/webp'\)\)\) \{\n    \.scene-page--add\{ --scene-image:image-set\(url\('\.\/assets\/club-photos\/add-stripe-wall\.webp'\) type\('image\/webp'\), url\('\.\/assets\/club-photos\/add-stripe-wall\.jpg'\) type\('image\/jpeg'\)\); \}/);
  for (const n of ["add-stripe-wall", "progress-blue-rig", "achievements-plates", "library-rings", "community-logo-wall"]) {
    const jpg = fs.statSync(new URL(`../assets/club-photos/${n}.jpg`, import.meta.url)).size, webp = fs.statSync(new URL(`../assets/club-photos/${n}.webp`, import.meta.url)).size;
    assert.ok(webp < jpg * 0.75, `${n}.webp (${webp}) is not clearly smaller than the JPEG (${jpg})`);
  }
});
