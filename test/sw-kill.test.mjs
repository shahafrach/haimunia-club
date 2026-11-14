// OPS-2 kill switch: clears every cache, unregisters, reloads clients once, touches nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function load() {
  const listeners = {};
  const log = { deleted: [], unregistered: 0, navigated: [], skipWaiting: 0, idb: 0 };
  const clientList = [
    { url: "https://x.test/", navigate: async (u) => log.navigated.push(u) },
    { url: "https://x.test/?swk=1", navigate: async (u) => log.navigated.push(u) },
  ];
  const self = {
    addEventListener: (t, f) => (listeners[t] = f),
    skipWaiting: () => log.skipWaiting++,
    registration: { unregister: async () => log.unregistered++ },
    clients: { matchAll: async () => clientList },
  };
  const caches = {
    keys: async () => ["haimunia-v3.7.2", "other-app-cache"],
    delete: async (k) => log.deleted.push(k),
  };
  const ctx = { self, caches, URL, get indexedDB() { log.idb++; return null; }, get localStorage() { log.idb++; return null; } };
  vm.runInNewContext(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"), ctx);
  return { listeners, log };
}

test("install takes over at once", () => {
  const { listeners, log } = load();
  listeners.install();
  assert.equal(log.skipWaiting, 1);
});

test("activate clears all caches, unregisters, reloads each client once, never touches member data", async () => {
  const { listeners, log } = load();
  let p;
  listeners.activate({ waitUntil: (x) => (p = x) });
  await p;
  assert.deepEqual(log.deleted, ["haimunia-v3.7.2", "other-app-cache"]);
  assert.equal(log.unregistered, 1);
  assert.deepEqual(log.navigated, ["https://x.test/?swk=1"]);
  assert.equal(log.idb, 0);
});

test("there is no fetch handler: requests go to the network", () => {
  assert.ok(!/addEventListener\(\s*["']fetch["']/.test(fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8")));
});
