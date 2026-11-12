// A missed manual version bump means users silently stay on stale code (see
// "Left for you" #3 in CHANGES.md's original hardening pass) — this is the
// safety net for that, independent of whether anyone remembers to run
// `npm run sync-version` by hand.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppVersion, readSwVersion } from "../scripts/sync-version.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("APP_VERSION (app.js) and SW_VERSION (sw.js) are in sync", () => {
  const appJs = readFileSync(path.join(root, "app.js"), "utf8");
  const swJs = readFileSync(path.join(root, "sw.js"), "utf8");
  const appVersion = readAppVersion(appJs);
  const swVersion = readSwVersion(swJs);
  assert.equal(swVersion, appVersion, `SW_VERSION (${swVersion}) must match APP_VERSION (${appVersion}) — run "npm run sync-version"`);
});
