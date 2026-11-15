// Settings → "בדיקת עדכון". The check asks the service worker registration to update and then goes
// through the app's own update handshake (pendingWorker + applyUpdate(): SKIP_WAITING ->
// controllerchange -> reload). The service worker is a fake that behaves like the browser's:
// update() may find a new worker, which fires updatefound, installs, answers GET_VERSION, and on
// SKIP_WAITING takes control (controllerchange). jsdom cannot reload, so the tests wrap the app's
// reloadOnce() (every update path reloads through it) and count the calls that got through.
import { test } from "node:test";
import assert from "node:assert";
import { MessageChannel } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const APP_VERSION = readFileSync(new URL("../app.js", import.meta.url), "utf8").match(/^const APP_VERSION = "([^"]+)";/m)[1];

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, tries = 300) { for (let i = 0; i < tries; i++) { if (await fn()) return; await wait(10); } assert.fail("timed out: " + label); }

function fakeServiceWorker(opts = {}) {
  const log = { update: 0, messages: [] };
  const swListeners = {};
  const sw = {
    controller: { state: "activated" }, // this tab was already under a worker at boot
    addEventListener: (t, f) => { (swListeners[t] = swListeners[t] || []).push(f); },
    removeEventListener: () => {},
  };
  const regListeners = {};
  function newWorker(version) {
    const wl = {};
    const w = {
      state: "installing",
      addEventListener: (t, f) => { (wl[t] = wl[t] || []).push(f); },
      removeEventListener: (t, f) => { wl[t] = (wl[t] || []).filter((x) => x !== f); },
      postMessage: (msg, ports) => {
        log.messages.push(msg && msg.type);
        if (msg && msg.type === "GET_VERSION" && ports && ports[0]) { ports[0].postMessage({ version }); ports[0].close(); }
        if (msg && msg.type === "SKIP_WAITING") {
          setTimeout(() => { w.state = "activated"; sw.controller = w; (swListeners.controllerchange || []).forEach((f) => f()); }, 5);
        }
      },
      _set(state) { w.state = state; (wl.statechange || []).forEach((f) => f()); },
    };
    return w;
  }
  const reg = {
    installing: null, waiting: null, active: sw.controller,
    addEventListener: (t, f) => { (regListeners[t] = regListeners[t] || []).push(f); },
    update: async () => {
      log.update++;
      if (opts.updateError) throw opts.updateError;
      if (opts.newVersion) {
        const w = newWorker(opts.newVersion);
        reg.installing = w;
        (regListeners.updatefound || []).forEach((f) => f());
        setTimeout(() => { reg.installing = null; reg.waiting = w; w._set("installed"); }, 30);
      }
      return reg;
    },
  };
  sw.register = async () => { log.registered = true; return reg; };
  sw.getRegistration = async () => reg;
  return { sw, reg, log };
}

async function boot(opts = {}) {
  const fake = fakeServiceWorker(opts);
  const window = await bootApp({
    serviceWorkerStub: fake.sw,
    beforeScripts: (w) => {
      w.MessageChannel = MessageChannel;
      w.scrollTo = () => {};
      if (opts.offline) Object.defineProperty(w.navigator, "onLine", { configurable: true, get: () => false });
    },
  });
  await until(() => fake.log.registered, "registered");
  await wait(20);
  // Count reload requests: reloadOnce() is a global function, and the app calls it by name.
  const reload = { calls: 0 };
  const orig = window.reloadOnce;
  window.reloadOnce = () => { reload.calls++; orig(); };
  return { window, reload, ...fake };
}
const status = (w) => (w.document.getElementById("updateCheckStatus") || { textContent: "" }).textContent.trim();
const button = (w) => w.document.querySelector("#settingsBody [data-action='check-update']");

test("the button sits by the version line in Settings, in the app's own chip style", async () => {
  const { window } = await boot();
  const b = button(window);
  assert.ok(b, "a check-update button in Settings");
  assert.equal(b.textContent.trim(), "בדיקת עדכון");
  assert.ok(b.classList.contains("chip-btn"));
  const footer = b.closest(".settings-sheet, #settingsBody") || window.document.getElementById("settingsBody");
  assert.match(footer.textContent, new RegExp("v" + APP_VERSION.replace(/\./g, "\\.")));
  assert.equal(window.document.getElementById("updateCheckStatus").getAttribute("role"), "status");
});

test("up to date: says so with the installed version, and nothing reloads", async () => {
  const { window, log, reload } = await boot();
  button(window).click();
  await until(() => /האפליקציה מעודכנת/.test(status(window)), "up-to-date text");
  assert.equal(status(window), `האפליקציה מעודכנת (גרסה ${APP_VERSION})`);
  assert.equal(log.update, 1, "registration.update() was asked once");
  assert.deepEqual(log.messages, [], "no SKIP_WAITING");
  assert.equal(reload.calls, 0);
  assert.equal(button(window).disabled, false, "the button is usable again");
});

test("update available: names the new version, waits for a running save, swaps through SKIP_WAITING and reloads once", async () => {
  const { window, log, reload } = await boot({ newVersion: "3.11.0" });
  await window.dbPutWodEntry({ id: "w1", date: "2026-11-15", name: "Fran", type: "ForTime", result: "5:00" });
  const realIdle = window.dbIdle;
  window.dbIdle = () => false; // an IndexedDB write is in progress
  button(window).click();
  await until(() => /יש גרסה חדשה 3\.11\.0\. מעדכנים…/.test(status(window)), "update text with the version");
  await wait(400);
  assert.ok(!log.messages.includes("SKIP_WAITING"), "no swap while a save is running");
  assert.equal(reload.calls, 0, "and no reload");
  window.dbIdle = realIdle; // the write finished
  await until(() => log.messages.includes("SKIP_WAITING"), "SKIP_WAITING after the save");
  await until(() => reload.calls >= 1, "reload");
  assert.deepEqual(log.messages.filter((m) => m === "SKIP_WAITING"), ["SKIP_WAITING"], "one swap request");
  assert.ok(log.messages.includes("GET_VERSION"), "the new worker was asked its version");
  const wods = await window.dbLoadWodEntries();
  assert.deepEqual(wods.map((w) => w.id), ["w1"], "the training log is untouched");
  button(window).click();
  await wait(60);
  assert.equal(log.update, 1, "once a reload has started, another tap does nothing");
});

test("offline: says so and does not even ask the registration", async () => {
  const { window, log, reload } = await boot({ offline: true });
  button(window).click();
  await until(() => status(window) === "אין חיבור כרגע. נסו שוב כשיש רשת.", "offline text");
  assert.equal(log.update, 0);
  assert.equal(reload.calls, 0);
});

test("a network failure inside update() is reported as offline too", async () => {
  const { window, log, reload } = await boot({ updateError: new TypeError("Failed to update a ServiceWorker: Failed to fetch") });
  button(window).click();
  await until(() => status(window) === "אין חיבור כרגע. נסו שוב כשיש רשת.", "offline text");
  assert.equal(log.update, 1);
  assert.equal(reload.calls, 0);
});

test("any other error: a short Hebrew message, nothing swaps, nothing reloads", async () => {
  const { window, log, reload } = await boot({ updateError: new TypeError("Failed to update a ServiceWorker: A bad HTTP response code (404) was received") });
  await window.dbPutWodEntry({ id: "w1", date: "2026-11-15", name: "Fran", type: "ForTime", result: "5:00" });
  button(window).click();
  await until(() => status(window) === "הבדיקה לא הצליחה. נסו שוב בעוד רגע.", "error text");
  assert.deepEqual(log.messages, []);
  assert.equal(reload.calls, 0);
  assert.equal(button(window).disabled, false);
  assert.deepEqual((await window.dbLoadWodEntries()).map((w) => w.id), ["w1"]);
});

test("the service worker answers GET_VERSION with its own SW_VERSION", async () => {
  const src = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(src, /e\.data\.type === "GET_VERSION" && e\.ports && e\.ports\[0\]\) e\.ports\[0\]\.postMessage\(\{ version: SW_VERSION \}\)/);
});
