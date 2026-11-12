#!/usr/bin/env node
// THE UPGRADE, REHEARSED IN A REAL BROWSER.
//
// What a member's phone goes through when 3.x replaces 2.34.0 at
// haimuniya.github.io/haimunia-app/, end to end, with nothing mocked:
//
//   1. 2.34.0 (commit 16d0cd8, what members run today) is served under
//      /haimunia-app/ with GitHub Pages' caching headers, its service worker
//      installs, and a member's history is created THROUGH ITS OWN CODE. A
//      second tab of it is left open, as a background PWA instance would be.
//   2. The deploy: the server starts serving this working tree instead.
//   3. The OLD page's own update flow - banner, tap, SKIP_WAITING,
//      controllerchange, reload - brings the new version in. Nothing new is
//      needed on the old side, and nothing new is used.
//   4. Checked: the new version is what is served (not the old cached one),
//      every record and setting is there, the old caches are gone, the second
//      tab is not stuck, a fresh tab gets the new version, it works offline,
//      and opening it touches no other origin.
//   5. The rollback: 2.34.0 is deployed again, and it still opens the data.
//
// Local-only by nature: it needs to swap what the server serves.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRoot } from "./lib/target.mjs";
import { startPagesServer } from "./lib/pages-server.mjs";

const OLD_COMMIT = process.env.OLD_COMMIT || "16d0cd8";
const NEW_VERSION = readFileSync(path.join(projectRoot, "app.js"), "utf8").match(/const APP_VERSION = "([^"]+)";/)[1];
let failed = false;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

const oldTree = mkdtempSync(path.join(os.tmpdir(), "haimunia-v2-"));
execFileSync("sh", ["-c", `git -C "${projectRoot}" archive ${OLD_COMMIT} | tar -x -C "${oldTree}"`]);
const server = await startPagesServer(oldTree);
const origin = new URL(server.url).origin;
console.log(`Serving ${OLD_COMMIT} at ${server.url}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const foreign = [];
ctx.on("request", (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith("data:") && !r.url().startsWith("blob:") && !r.url().includes("/rest/v1/training_log_usage")) foreign.push(r.url()); });
// The anonymous usage count is the one request allowed out, and it must
// fail silently: here it always fails, as it would offline or blocked, and
// the checks below still expect a working app with no page errors.
const usageTries = [];
await ctx.route("**/rest/v1/training_log_usage", (route) => { usageTries.push(route.request().method()); return route.abort(); });

const waitActive = (page) => page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === "activated", null, { timeout: 20000 });
const version = (page) => page.evaluate(() => (typeof APP_VERSION === "string" ? APP_VERSION : null));
const idbCounts = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open("box-log-db");
  req.onsuccess = async () => {
    const db = req.result; const out = { version: db.version, stores: {} };
    for (const n of db.objectStoreNames) out.stores[n] = await new Promise((r) => { const q = db.transaction(n).objectStore(n).count(); q.onsuccess = () => r(q.result); });
    db.close(); resolve(out);
  };
  req.onerror = () => reject(String(req.error));
}));

try {
  // ---- 1. 2.34.0, installed, with a history ----
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(server.url, { waitUntil: "networkidle" });
  await waitActive(page);
  check("2.34.0 is what is served first", (await version(page)) === "2.34.0", await version(page));

  await page.evaluate(async () => {
    const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
    window.scrollTo = () => {};
    saveWelcomeForm("דנה"); closeOnboarding();
    setThemePref("light"); setTextScalePref("large"); setBarWeight(15);
    choosePickedMovement("back-squat");
    for (const [kg, reps] of [[60, 5], [80, 3], [90, 1]]) { applyFieldValue("step", "weight", kg); applyFieldValue("step", "reps", reps); applyFieldValue("step", "sets", 1); await saveSet(); await tick(); }
    const cel = document.querySelector("#celebrationOverlay.open [data-action='close-celebration']"); if (cel) cel.click();
    openWodBuilder();
    document.getElementById("wodBuilderName").value = "EMOM שלישי";
    document.querySelector("[data-action='builder-set-format'][data-format='emom']").click();
    toggleBuilderMovement("Wall Balls"); applyFieldValue("builder-movement-reps", "Wall Balls", 12);
    toggleBuilderMovement("Burpees"); document.querySelector("[data-action='toggle-builder-movement-rest'][data-name='Burpees']").click();
    toggleBuilderMovement("Plank Hold"); document.querySelector("[data-action='toggle-builder-movement-type'][data-name='Plank Hold'][data-type='duration']").click(); applyFieldValue("builder-movement-duration", "Plank Hold", 45);
    createWodFromBuilder(); await tick(150);
    document.getElementById("tabWodBtn").click(); await tick();
    applyFieldValue("wod-emom-step", "0", 11); applyFieldValue("wod-emom-step", "2", 40); await saveWod(); await tick();
    applyFieldValue("bw-step", "bwWeight", 72.5); await saveBodyweight(); await tick();
    await addMeasureType("מותניים"); const mt = (await dbLoadMeasureTypes())[0];
    applyFieldValue("measure-step", mt.id, 81); await saveMeasurement(mt.id); await tick();
    await saveSessionNote(todayISO(), "הרגשתי חזק היום"); await tick(200);
  });
  const before = await idbCounts(page);
  const oldWod = await page.evaluate(() => dbLoadCustomWods().then((l) => l[0]));
  check("2.34.0 wrote a history", before.stores.entries === 3 && before.stores.wodEntries === 1 && before.stores.customWods === 1, JSON.stringify(before.stores));
  check("2.34.0's own EMOM has a rest and a timed station", JSON.stringify(oldWod.emomMovementTypes) === '["reps","rest","duration"]');
  const oldCaches = await page.evaluate(() => caches.keys());
  const settingsRows = (p) => p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("box-log-db");
    req.onsuccess = () => { const r = req.result.transaction("settings").objectStore("settings").getAll(); r.onsuccess = () => { req.result.close(); resolve(r.result); }; };
  }));
  const oldSettings = await settingsRows(page);

  const tab2 = await ctx.newPage();
  await tab2.goto(server.url, { waitUntil: "networkidle" });
  check("a second tab of 2.34.0 is open", (await version(tab2)) === "2.34.0");

  // ---- 2. deploy ----
  server.setRoot(projectRoot);
  console.log("Deployed the working tree over it.");

  // ---- 3. the old page's own update flow ----
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await page.waitForFunction(() => document.getElementById("updateBanner")?.style.display === "block", null, { timeout: 20000 });
  check("2.34.0 shows its own update banner for the new version", true);
  const reloaded = page.waitForEvent("load", { timeout: 20000 });
  await page.click("#updateBanner");
  await reloaded;
  await page.waitForFunction(() => document.getElementById("loading")?.style.display === "none", null, { timeout: 15000 });

  // ---- 4. what the member has now ----
  const v = await version(page);
  check("the NEW version is what runs after the update, not the old cached one", v === NEW_VERSION, `APP_VERSION=${v}`);
  check("and its new index.html, not an HTTP-cached 2.34.0 one (which would pair old markup with new scripts)",
    await page.evaluate(() => !!document.querySelector('script[src="./src/db.js"]')));
  const ctrl = await page.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL);
  const newCaches = await page.evaluate(() => caches.keys());
  check("the new worker's cache exists", newCaches.includes(`haimunia-v${NEW_VERSION}`), JSON.stringify(newCaches));
  check("2.34.0's cache is gone", oldCaches.every((k) => !newCaches.includes(k)), `before=${JSON.stringify(oldCaches)}`);
  check("the page is controlled by the worker at the same URL", !!ctrl && ctrl.endsWith("/haimunia-app/sw.js"), ctrl);

  const after = await idbCounts(page);
  check("the database is still box-log-db v7", after.version === 7, `version ${after.version}`);
  const recordStores = (c) => JSON.stringify(Object.fromEntries(Object.entries(c.stores).filter(([n]) => n !== "settings")));
  check("every record store kept every record", recordStores(after) === recordStores(before), `${recordStores(before)} -> ${recordStores(after)}`);
  // Settings may GAIN rows (the flags 2.x never wrote are bootstrapped, the
  // edition marker comes later) but must not lose or change one - except the
  // two the app is meant to move: lastSeenVersion, as what's new is shown,
  // and seenAchievements, which only ever grows.
  const newSettings = await settingsRows(page);
  const lost = oldSettings.filter((o) => {
    const n = newSettings.find((x) => x.key === o.key);
    if (!n) return true;
    if (o.key === "haimunia:lastSeenVersion") return false;
    if (o.key === "haimunia:seenAchievements") return !o.value.every((id) => n.value.includes(id));
    return JSON.stringify(n.value) !== JSON.stringify(o.value);
  }).map((o) => o.key);
  check("every settings row 2.34.0 wrote is still there, unchanged", lost.length === 0, lost.join(", "));
  const state = await page.evaluate(() => ({
    name: document.getElementById("userGreeting")?.textContent || "",
    theme: document.documentElement.getAttribute("data-theme"),
    scale: document.documentElement.getAttribute("data-text-scale"),
    whatsNewOpen: document.getElementById("notificationsOverlay")?.classList.contains("open"),
    whatsNew: document.getElementById("notificationsList")?.textContent || "",
    welcome: document.getElementById("welcomeOverlay")?.classList.contains("open"),
    squats: entriesFor("back-squat").length,
    wod: allWods().find((w) => w.name === "EMOM שלישי"),
    emomReps: wodEntries[0] && wodEntries[0].emomReps,
    storageErr: storageErrMsg || "",
  }));
  check("the member's name is on screen", state.name.includes("דנה"), state.name);
  check("light theme and large text kept", state.theme === "light" && state.scale === "large", `${state.theme}/${state.scale}`);
  check("no welcome sheet, no storage error", !state.welcome && !state.storageErr, state.storageErr);
  check("strength history is all there", state.squats === 3);
  check("the custom EMOM kept its rest and timed stations", JSON.stringify(state.wod && state.wod.emomMovementTypes) === '["reps","rest","duration"]'
    && JSON.stringify(state.wod.emomTargetDurations) === "[0,0,45]");
  check("the logged EMOM result kept its compacted reps", JSON.stringify(state.emomReps) === "[11,40]", JSON.stringify(state.emomReps));
  check("what's new opens once, with the 3.0.0 entry", state.whatsNewOpen && state.whatsNew.includes("3.0.0") && !state.whatsNew.includes("קהילה"));

  // The other tab: its page was not the one that asked for the swap, so 2.x
  // leaves it running. It must not be stuck (no version-change block: the
  // database version never moved) and its next load is the new version.
  const tab2Alive = await tab2.evaluate(() => dbLoadAll().then((l) => l.length)).catch((e) => String(e));
  check("the second, still-open 2.34.0 tab can still read the database", tab2Alive === 3, String(tab2Alive));
  await tab2.reload({ waitUntil: "networkidle" });
  check("and reloading it brings the new version", (await version(tab2)) === NEW_VERSION);
  await tab2.close();

  const fresh = await ctx.newPage();
  await fresh.goto(server.url, { waitUntil: "networkidle" });
  check("a fresh tab opens the new version", (await version(fresh)) === NEW_VERSION);
  await fresh.close();

  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("loading")?.style.display === "none", null, { timeout: 15000 });
  check("offline: the new version loads from its own cache", (await version(page)) === NEW_VERSION);
  check("offline: with the data", await page.evaluate(() => entriesFor("back-squat").length === 3));
  await ctx.setOffline(false);

  check("nothing requested any other origin", foreign.length === 0, foreign.slice(0, 5).join(", "));
  check("the new version did try its anonymous count, and its failing broke nothing", usageTries.length > 0, `${usageTries.length} attempts`);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  // ---- 5. rollback ----
  server.setRoot(oldTree);
  console.log("Rolled the deploy back to 2.34.0.");
  const rolled = page.waitForEvent("load", { timeout: 20000 });
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }));
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await rolled;
  await page.waitForFunction(() => document.getElementById("loading")?.style.display === "none", null, { timeout: 15000 });
  const rb = await page.evaluate(() => ({ v: APP_VERSION, n: entriesFor("back-squat").length, err: document.body.textContent.includes("שמירה נכשלה") }));
  check("rollback: 2.34.0 runs again", rb.v === "2.34.0", rb.v);
  check("rollback: and still opens the member's data", rb.n === 3 && !rb.err);
} finally {
  await browser.close();
  await server.close();
  rmSync(oldTree, { recursive: true, force: true });
}

console.log(failed ? "\nupgrade-rehearsal: FAILED" : "\nupgrade-rehearsal: all checks passed");
process.exit(failed ? 1 : 0);
