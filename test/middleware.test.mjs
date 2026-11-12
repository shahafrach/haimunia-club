// functions/_middleware.js: the repo root is the website, so tooling and notes are answered with 404, and
// nothing the app needs ever is. The second half is the one that matters: a blocked app file is an outage.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBlocked, onRequest } from "../functions/_middleware.js";
import { SCRIPT_FILES } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");

test("tooling, tests, notes and the dev manifest are blocked, in every spelling", () => {
  for (const p of ["/test/connect.test.mjs", "/test/fixtures/old-app-backup-v1.json", "/scripts/browser-check/run-all.mjs",
    "/.github/workflows/x.yml", "/node_modules/x/index.js", "/functions/_middleware.js", "/package.json", "/package-lock.json",
    "/CLAUDE.md", "/CHANGES.md", "/notes.sql", "/x.mjs",
    "/%74est/connect.test.mjs", "/%2574est/x", "/TEST/x", "/test%2Fx", "//test/x", "/\\test\\x", "/%E0%A4%A", "/%"]) {
    assert.equal(isBlocked(p), true, p);
  }
});

test("every file the app loads, precaches or links is served", () => {
  const sw = read("sw.js");
  const list = (name) => [...sw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1].matchAll(/"\.\/([^"]*)"/g)].map((m) => "/" + m[1]);
  const files = [...SCRIPT_FILES.map((f) => "/" + f), ...list("REQUIRED_ASSETS"), ...list("OPTIONAL_ASSETS"),
    "/", "/index.html", "/sw.js", "/manifest.json", "/privacy.html", "/404.html", "/theme-init.js", "/frame-guard.js", "/vendor/supabase.js", "/_headers"];
  for (const f of new Set(files)) assert.equal(isBlocked(f), false, f);
});

test("nothing blocked is a file the page references; every top-level file is either blocked or intentionally public", () => {
  const html = read("index.html");
  for (const m of html.matchAll(/(?:src|href)="\.?\/?([^"#?]+)"/g)) {
    if (/^(https?:|data:|mailto:)/.test(m[1])) continue;
    assert.equal(isBlocked("/" + m[1]), false, m[1]);
  }
  const PUBLIC = new Set(["404.html", "app-config.js", "app.js", "frame-guard.js", "index.html", "manifest.json", "privacy.html", "sw.js", "theme-init.js", "_headers"]);
  for (const name of readdirSync(root)) {
    if (statSync(path.join(root, name)).isDirectory() || name.startsWith(".")) continue;
    if (/\.(png|ico|jpg|jpeg|svg)$/.test(name)) continue;
    assert.ok(PUBLIC.has(name) || isBlocked("/" + name), `/${name} is served: add it to PUBLIC here on purpose, or block it`);
  }
});

test("a blocked request gets a 404 that is never cached and carries its own security headers; the rest passes through", async () => {
  const r = await onRequest({ request: new Request("https://haimunia.pages.dev/CHANGES.md"), next: async () => new Response("asset") });
  assert.equal(r.status, 404);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(await r.text(), "Not found");
  const ok = await onRequest({ request: new Request("https://haimunia.pages.dev/app.js"), next: async () => new Response("asset") });
  assert.equal(await ok.text(), "asset");
});
