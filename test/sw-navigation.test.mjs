// Audit 2026-11, findings 3 and 5. Runs the real sw.js in a vm sandbox with
// an in-memory Cache Storage and a fetch the test controls, and checks:
//  - a start never waits on the network once the worker has its cache
//    (weak gym signal: the request hangs, the app still opens);
//  - offline start works;
//  - shell and scripts always come from ONE release, even when the network
//    already serves the next one (no mixed versions);
//  - the upgrade from 3.6.0's worker state: its cache goes, other apps'
//    caches stay, navigation preload is switched off, SKIP_WAITING still
//    swaps, and the worker never touches member data.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SW_SRC = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const SW_VERSION = SW_SRC.match(/const SW_VERSION = "([^"]+)";/)[1];
const BASE = "https://haimunia.pages.dev/";

class FakeCache {
  constructor() { this.map = new Map(); }
  key(req, ignoreSearch) {
    const u = new URL(typeof req === "string" ? req : req.url, BASE);
    return u.origin + u.pathname + (ignoreSearch ? "" : u.search);
  }
  async match(req, opts = {}) {
    const k = this.key(req, opts.ignoreSearch);
    for (const [key, res] of this.map) {
      const kk = opts.ignoreSearch ? key.split("?")[0] : key;
      if (kk === k) return res.clone();
    }
    return undefined;
  }
  async put(req, res) { this.map.set(this.key(req, false), res); }
  async add(req) {
    const res = await sandbox.__fetch(req);
    if (!res.ok) throw new TypeError("bad status");
    await this.put(req, res);
  }
}
let sandbox;
function makeWorker({ preexisting = [] } = {}) {
  const stores = new Map(preexisting.map((n) => [n, new FakeCache()]));
  const handlers = {};
  const calls = { skipWaiting: 0, claim: 0, preload: null };
  const network = { body: (path) => `v1:${path}`, mode: "ok" };
  const RealRequest = globalThis.Request;
  sandbox = {
    console: { log() {}, warn() {}, error() {} },
    URL, Response, Promise, setTimeout,
    Request: class extends RealRequest {
      constructor(u, o) { super(typeof u === "string" ? new URL(u, BASE).href : u, o); }
    },
    caches: {
      async open(n) { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n); },
      async keys() { return [...stores.keys()]; },
      async delete(n) { return stores.delete(n); },
    },
    __fetch: async (req) => {
      if (network.mode === "offline") throw new TypeError("Failed to fetch");
      if (network.mode === "hang") return new Promise(() => {});
      const path = new URL(req.url || req, BASE).pathname;
      return new Response(network.body(path), { status: 200 });
    },
  };
  sandbox.fetch = (r) => sandbox.__fetch(r);
  sandbox.self = {
    location: new URL(BASE + "sw.js"),
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: () => { calls.skipWaiting += 1; },
    clients: { claim: async () => { calls.claim += 1; } },
    registration: { navigationPreload: {
      enable: async () => { calls.preload = "enabled"; },
      disable: async () => { calls.preload = "disabled"; },
    } },
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox);
  const box = sandbox;
  return {
    stores, calls, network, handlers,
    async install() { let p; handlers.install({ waitUntil: (x) => { p = x; } }); await p; },
    async activate() { let p; handlers.activate({ waitUntil: (x) => { p = x; } }); await p; },
    fetch(path, mode = "no-cors") {
      sandbox = box;
      let p = null;
      const ev = { request: { url: new URL(path, BASE).href, method: "GET", mode }, respondWith: (x) => { p = x; }, preloadResponse: Promise.resolve(undefined) };
      handlers.fetch(ev);
      return p;
    },
  };
}
const text = async (p) => (await p).text();
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms`)), ms))]);

test("install precaches into this version's own cache", async () => {
  const w = makeWorker();
  await w.install();
  const name = `haimunia-v${SW_VERSION}`;
  assert.ok(w.stores.has(name));
  assert.ok(await w.stores.get(name).match("./index.html"));
  assert.ok(await w.stores.get(name).match("./app.js"));
});

test("a start on a hanging network opens from the cache at once", async () => {
  const w = makeWorker();
  await w.install();
  w.network.mode = "hang";
  assert.equal(await within(text(w.fetch("./", "navigate")), 200), "v1:/");
  assert.equal(await within(text(w.fetch("./app.js")), 200), "v1:/app.js");
});

test("offline start works, including a manifest shortcut with a query string", async () => {
  const w = makeWorker();
  await w.install();
  w.network.mode = "offline";
  assert.equal(await text(w.fetch("./", "navigate")), "v1:/");
  assert.equal(await text(w.fetch("./index.html?tab=add", "navigate")), "v1:/index.html");
  assert.equal(await text(w.fetch("./some/unknown/page", "navigate")), "v1:/index.html", "unknown pages fall back to the shell offline");
});

test("no mixed versions: with the next release already on the network, shell and scripts stay on this one", async () => {
  const w = makeWorker();
  await w.install();
  w.network.body = (path) => `v2:${path}`;
  assert.equal(await text(w.fetch("./", "navigate")), "v1:/");
  assert.equal(await text(w.fetch("./app.js")), "v1:/app.js");
  assert.equal(await text(w.fetch("./src/db.js")), "v1:/src/db.js");
  await new Promise((r) => setTimeout(r, 10));
  // Nothing from v2 was written under this version's name in the background.
  const cache = w.stores.get(`haimunia-v${SW_VERSION}`);
  assert.equal(await (await cache.match("./app.js")).text(), "v1:/app.js");
  assert.equal(await (await cache.match("./index.html")).text(), "v1:/index.html");
});

test("a page that was never precached is still fetched from the network", async () => {
  const w = makeWorker();
  await w.install();
  assert.equal(await text(w.fetch("./not-precached.html", "navigate")), "v1:/not-precached.html");
});

test("upgrade from 3.6.0: its cache is removed, other apps' caches stay, preload goes off, clients are claimed", async () => {
  const w = makeWorker({ preexisting: ["haimunia-v3.6.0", "haimunia-v2.34.0", "some-other-app-cache"] });
  await w.install();
  await w.activate();
  const keys = [...w.stores.keys()].sort();
  assert.deepEqual(keys, [`haimunia-v${SW_VERSION}`, "some-other-app-cache"].sort());
  assert.equal(w.calls.preload, "disabled", "3.6.0 enabled navigation preload; this worker never uses it");
  assert.equal(w.calls.claim, 1);
});

test("the update banner's SKIP_WAITING still swaps the worker, and install never does it alone", async () => {
  const w = makeWorker();
  await w.install();
  assert.equal(w.calls.skipWaiting, 0);
  w.handlers.message({ data: { type: "SKIP_WAITING" } });
  assert.equal(w.calls.skipWaiting, 1);
});

test("the worker never touches member data", () => {
  assert.doesNotMatch(SW_SRC.replace(/\/\/.*$/gm, ""), /indexedDB|localStorage|IDB/,
    "member data lives in IndexedDB; the worker only handles cached files");
});
