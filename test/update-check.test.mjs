// Settings → "בדיקת עדכון". The check asks the service worker registration to update and then goes
// through the app's own update handshake (pendingWorker + applyUpdate(): SKIP_WAITING ->
// controllerchange -> reload). The service worker is a fake that behaves like the browser's:
// update() may find a new worker, which fires updatefound, installs, answers GET_VERSION, and on
// SKIP_WAITING takes control (controllerchange). jsdom cannot reload, so the tests replace the app's
// hardReload() (the one real reload, reached only through reloadOnce()) and count the calls.
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
    // this tab was already under a worker at boot, unless the test boots a fresh install
    controller: opts.noControllerAtBoot ? null : { state: "activated" },
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
          if (opts.onSkipWaiting) opts.onSkipWaiting();
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
  // A worker taking control without being asked (clients.claim() after skipWaiting() on install).
  sw._claim = (w) => { sw.controller = w; (swListeners.controllerchange || []).forEach((f) => f()); };
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
  // Count real reloads: hardReload() is a global function, and reloadOnce() calls it by name.
  const reload = { calls: 0 };
  window.hardReload = () => { reload.calls++; };
  if (opts.afterBoot) opts.afterBoot(window);
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

// F-020 (real Chromium, ac7bab1). With no controller at boot (the first launch of a fresh install) the
// reload comes from controllerchange or the 4 s backstop, after checkForUpdate() looked for running saves.
// A dbPut that starts right after applyUpdate() must finish before any reload, and its row must be on disk.
test("F-020: no controller at boot, a slow dbPut started after applyUpdate(): no reload until it is written", async () => {
  const state = { window: null, putDone: false, events: [] };
  const entry = { id: "late-1", exerciseId: "back-squat", date: "2026-11-15", type: "reps", weight: 80, reps: 5, sets: 1, durationSeconds: 0, ts: 1, isPR: false, groupId: null, blockLabel: null, est1RM: 93.3 };
  const { window, log, reload } = await boot({
    newVersion: "3.11.0",
    noControllerAtBoot: true,
    onSkipWaiting: () => {
      const w = state.window;
      // dbPut is slow inside its own call: openDB() takes 700 ms, so the write is in flight the whole time.
      const realOpen = w.openDB;
      w.openDB = async () => { await new Promise((r) => setTimeout(r, 700)); w.openDB = realOpen; return realOpen(); };
      state.events.push("put-start");
      w.dbPut(entry).then(() => { state.putDone = true; state.events.push("put-done"); });
    },
  });
  state.window = window;
  const realHard = window.hardReload;
  window.hardReload = () => { state.events.push("reload"); realHard(); };
  button(window).click();
  await until(() => log.messages.includes("SKIP_WAITING"), "SKIP_WAITING");
  await wait(300);
  assert.equal(reload.calls, 0, "no reload while the put is in flight");
  await until(() => state.putDone, "the put finished", 400);
  await until(() => reload.calls >= 1, "reload after the put", 400);
  await wait(4300); // past the 4 s backstop: still one reload
  assert.equal(reload.calls, 1, "at most one reload");
  assert.deepEqual(state.events, ["put-start", "put-done", "reload"], "the write lands before the reload");
  const all = await window.dbLoadAll();
  assert.ok(all.some((e) => e.id === "late-1"), "the row is on disk");
});

test("F-020: a save tried during \"מעדכנים…\" is held back with a toast, and the draft stays", async () => {
  const { window, reload } = await boot({ newVersion: "3.11.0" });
  await window.dbPutWodEntry({ id: "w1", date: "2026-11-15", name: "Fran", type: "ForTime", result: "5:00" });
  const before = (await window.dbLoadAll()).length;
  const realIdle = window.dbIdle;
  window.dbIdle = () => false; // a write is running, so the update waits in "מעדכנים…"
  button(window).click();
  await until(() => /מעדכנים…/.test(status(window)), "updating text");
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 87.5);
  window.applyFieldValue("step", "reps", 3);
  window.render();
  window.document.getElementById("bottomBarBtn").click();
  await until(() => /רגע, האפליקציה מתעדכנת/.test((window.document.getElementById("appToastDock") || {}).textContent || ""), "the hold toast");
  await window.deleteWodEntry("w1");
  assert.equal((await window.dbLoadAll()).length, before, "no set was written");
  assert.deepEqual((await window.dbLoadWodEntries()).map((w) => w.id), ["w1"], "and nothing was deleted");
  const vals = ["weight", "reps"].map((f) => window.document.querySelector(`input.stepper-val[data-field="${f}"]`).value);
  assert.deepEqual(vals, ["87.5", "3"], "the draft is still in the steppers");
  assert.equal(reload.calls, 0);
  window.dbIdle = realIdle;
  await until(() => reload.calls === 1, "the update goes on once the write is done", 400);
});

test("F-025: first visit (no controller at boot), a new worker activates on install: tapping the banner reloads", async () => {
  const { window, sw, reg, log, reload } = await boot({ noControllerAtBoot: true, newVersion: "3.18.0" });
  // The first worker claims the page: that is not an update, nothing reloads.
  sw._claim({ state: "activated" });
  await wait(20);
  assert.equal(reload.calls, 0, "the first-ever claim does not reload");
  // A new version arrives while the page is visible: the banner is offered.
  Object.defineProperty(window.document, "visibilityState", { configurable: true, get: () => "visible" });
  await reg.update();
  await until(() => window.document.getElementById("updateBanner").style.display === "block", "the update banner");
  // sw.js calls skipWaiting() on install: the new worker activates and claims the page before any tap.
  sw._claim(reg.waiting);
  await wait(20);
  assert.equal(reload.calls, 0, "that swap alone never reloads an active session");
  // The tap now reloads (it used to post SKIP_WAITING to an active worker and wait forever).
  window.document.getElementById("updateBanner").click();
  await until(() => reload.calls === 1, "a reload after the tap");
  assert.ok(!log.messages.includes("SKIP_WAITING"), "nothing left to hand-shake with: it reloads directly");
});

test("F-025 keeps F-020: on that first visit, the tap waits for a running save before it reloads", async () => {
  const { window, sw, reg, reload } = await boot({ noControllerAtBoot: true, newVersion: "3.18.0" });
  sw._claim({ state: "activated" });
  Object.defineProperty(window.document, "visibilityState", { configurable: true, get: () => "visible" });
  await reg.update();
  await until(() => window.document.getElementById("updateBanner").style.display === "block", "the update banner");
  sw._claim(reg.waiting);
  const realIdle = window.dbIdle;
  window.dbIdle = () => false; // an IndexedDB write is in progress
  window.document.getElementById("updateBanner").click();
  await wait(400);
  assert.equal(reload.calls, 0, "no reload while a save is running");
  window.dbIdle = realIdle;
  await until(() => reload.calls === 1, "the reload once the save finished");
});
