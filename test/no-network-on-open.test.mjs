// NOTHING LEAVES THE PHONE ON OPEN - EXCEPT THE ANONYMOUS COUNT.
//
// This edition has no server of its own. The one request it makes is the
// usage count (src/usage.js), to one endpoint, and with counting switched off
// it makes none at all. Two layers say so: the CSP in index.html allows no
// origin but 'self' for anything, except that one host for connections; and
// booting the app, through every screen, requests nothing else.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, SCRIPT_FILES } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");
const USAGE_HOST = read("app-config.js").match(/url: "(https:\/\/[^"]+)"/)[1];

test("the CSP names no origin but 'self' - and the usage host for connect-src only", () => {
  const csp = read("index.html").match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directives = csp.split(";").map((d) => d.trim()).filter(Boolean);
  for (const d of directives) {
    if (d.startsWith("connect-src")) assert.equal(d, `connect-src 'self' ${USAGE_HOST}`);
    else assert.doesNotMatch(d, /https?:|wss?:|\*/, d);
  }
});

test("no shipped script names a remote host, except the usage endpoint in app-config.js", () => {
  for (const f of SCRIPT_FILES) {
    const code = read(f).replace(/^\s*\/\/.*$/gm, "");
    const hosts = [...code.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1])
      // wa.me is the member's own hand-off in the support sheet, opened only
      // when they tap it; w3.org is the SVG namespace string.
      .filter((h) => !/^(wa\.me|www\.w3\.org)$/.test(h))
      .filter((h) => !(f === "app-config.js" && `https://${h}` === USAGE_HOST));
    assert.deepEqual(hosts, [], `${f} names ${hosts.join(", ")}`);
  }
});

function recordingBoot(opts = {}) {
  const calls = [];
  return bootApp({
    ...opts,
    beforeScripts: (w) => {
      w.fetch = (...a) => { calls.push(["fetch", String(a[0])]); return Promise.resolve({ ok: true, status: 201 }); };
      const Xhr = w.XMLHttpRequest;
      w.XMLHttpRequest = function () { const x = new Xhr(); const o = x.open; x.open = (m, u, ...r) => { calls.push(["xhr", String(u)]); return o.call(x, m, u, ...r); }; return x; };
      w.navigator.sendBeacon = (u) => { calls.push(["beacon", String(u)]); return true; };
      w.WebSocket = function (u) { calls.push(["ws", String(u)]); throw new Error("no"); };
      w.scrollTo = () => {};
    },
  }).then((window) => ({ window, calls }));
}
async function visitEveryScreen(window) {
  for (const t of ["add", "history", "calendar", "wod", "add"]) {
    window.document.querySelector(`[data-action='switch-tab'][data-tab='${t}']`).click();
    await new Promise((r) => setTimeout(r, 30));
  }
}

test("booting and visiting every screen requests nothing but the usage endpoint", async () => {
  const { window, calls } = await recordingBoot();
  await visitEveryScreen(window);
  assert.ok(calls.length > 0, "the counts did go out");
  for (const [kind, url] of calls) {
    assert.equal(kind, "fetch");
    assert.equal(url, `${USAGE_HOST}/rest/v1/training_log_usage`);
  }
});

test("with counting switched off, booting and visiting every screen makes no request at all", async () => {
  const { window, calls } = await recordingBoot({ localStorage: { "haimunia:usageCountingOff": "1" } });
  await visitEveryScreen(window);
  assert.deepEqual(calls, []);
});
