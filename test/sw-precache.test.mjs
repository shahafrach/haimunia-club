// THE SERVICE WORKER IS THE UPDATE PATH AND THE OFFLINE PATH.
//
// A file index.html loads but sw.js does not precache works online and
// breaks offline with no signal. A REQUIRED asset that does not exist makes
// install fail, and the previous version keeps running - safe, but the update
// never arrives. Both are checked against the files on disk.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCRIPT_FILES } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");
const sw = read("sw.js");
const list = (name) => {
  const m = sw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return [...m[1].matchAll(/"\.\/([^"]*)"/g)].map((x) => x[1]);
};
const REQUIRED = list("REQUIRED_ASSETS");
const OPTIONAL = list("OPTIONAL_ASSETS");

// 3.12.0: the error reports and the feedback box are OPTIONAL on purpose (queue Q-03): the app runs without
// them, every call into them goes through window.HaimuniaErrors / window.HaimuniaFeedback with a guard, so a
// failed precache must not fail the install. Exactly these two, and they must be optional, not missing.
const OPTIONAL_SCRIPTS = ["src/errors.js", "src/feedback.js"];
test("every script index.html loads is a REQUIRED asset (the two optional ones are precached as OPTIONAL)", () => {
  for (const f of SCRIPT_FILES) {
    if (OPTIONAL_SCRIPTS.includes(f)) { assert.ok(OPTIONAL.includes(f), `${f} is loaded but not in OPTIONAL_ASSETS`); continue; }
    assert.ok(REQUIRED.includes(f), `${f} is loaded but not in REQUIRED_ASSETS`);
  }
  for (const f of OPTIONAL_SCRIPTS) assert.ok(SCRIPT_FILES.includes(f), `${f} is listed as an optional script but index.html does not load it`);
  for (const f of ["index.html", "theme-init.js", "frame-guard.js"]) assert.ok(REQUIRED.includes(f), f);
});

test("every precached path exists on disk", () => {
  for (const f of [...REQUIRED, ...OPTIONAL]) {
    if (f === "") continue; // "./" is the directory index
    assert.ok(existsSync(path.join(root, f)), `sw.js precaches ./${f}, which does not exist`);
  }
});

test("every asset the app references is precached", () => {
  const src = read("index.html") + read("app.js");
  const refs = new Set([...src.matchAll(/\.?\/?(assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|woff2))/g)].map((m) => m[1]));
  assert.ok(refs.size > 10, "found the asset references");
  // Q-56: a scene photo's JPEG is the fallback for engines without image-set() type(); its WebP twin is the
  // precached copy, and sw.js keeps the JPEG in the static cache if an old engine fetches it.
  const twin = (r) => r.replace(/\.jpe?g$/, ".webp");
  for (const r of refs) assert.ok(OPTIONAL.includes(r) || REQUIRED.includes(r) || (/\.jpe?g$/.test(r) && OPTIONAL.includes(twin(r))), `${r} is used but not precached`);
});

test("the worker answers SKIP_WAITING - the message 2.x's update banner sends", () => {
  assert.match(sw, /e\.data && e\.data\.type === "SKIP_WAITING"\) self\.skipWaiting\(\)/);
});

test("no push or notification handlers survive from the community edition", () => {
  assert.doesNotMatch(sw, /addEventListener\("(push|notificationclick)"/);
});

test("APP_VERSION and SW_VERSION agree and are above 2.34.0", () => {
  const app = read("app.js").match(/const APP_VERSION = "([^"]+)";/)[1];
  const swv = sw.match(/const SW_VERSION = "([^"]+)";/)[1];
  assert.equal(app, swv);
  const [a, b, c] = app.split(".").map(Number);
  assert.ok(a > 2 || (a === 2 && (b > 34 || (b === 34 && c > 0))), `${app} must sort above 2.34.0 for the update and the what's-new list`);
});
