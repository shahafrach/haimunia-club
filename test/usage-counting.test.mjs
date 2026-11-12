// ANONYMOUS USAGE COUNTING, FROM THE MEMBER'S SIDE.
//
// What the club asked for: how many people use the app and how many log
// workouts. What the member is owed: exactly three facts leave the phone,
// with a random id and nothing else; a visible switch turns it off; and
// nothing about the app depends on whether a count got through.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, answerWodRx } from "./helpers/boot.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// Records every request the app makes; `respond` decides what the network does.
function recorder(respond = () => Promise.resolve({ ok: true, status: 201 })) {
  const calls = [];
  return {
    calls,
    beforeScripts: (w) => {
      w.scrollTo = () => {};
      w.fetch = (url, init) => { calls.push({ url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null }); return respond(url, init); };
    },
  };
}
const bodies = (calls) => calls.map((c) => c.body);

test("on open: one app_open and one screen_open, carrying a random id and nothing else", async () => {
  const r = recorder();
  const window = await bootApp({ beforeScripts: r.beforeScripts });
  await tick(100);
  const cfg = window.HAIMUNIA_CONFIG.usage;
  assert.ok(r.calls.length >= 1);
  for (const c of r.calls) {
    assert.equal(c.url, cfg.url + "/rest/v1/training_log_usage", "the one endpoint");
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.credentials, "omit", "no cookies");
    assert.deepEqual(Object.keys(c.body).sort().filter((k) => k !== "screen"), ["device_id", "event"], "no other field, ever");
    assert.match(c.body.device_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "a random v4 uuid");
  }
  const events = bodies(r.calls).map((b) => b.event + (b.screen ? ":" + b.screen : "")).sort();
  assert.deepEqual(events, ["app_open", "screen_open:add"]);
  assert.equal(new Set(bodies(r.calls).map((b) => b.device_id)).size, 1, "one device, one id");
});

test("logging a workout counts workout_logged - with no trace of the workout in it", async () => {
  const r = recorder();
  const window = await bootApp({ beforeScripts: r.beforeScripts });
  await tick(100);
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 100);
  window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await tick(100);
  const logged = bodies(r.calls).filter((b) => b.event === "workout_logged");
  assert.equal(logged.length, 1);
  const wire = JSON.stringify(r.calls.map((c) => c.body));
  assert.ok(!/100|back-squat|Back Squat|squat/i.test(wire.replace(/"device_id":"[^"]+"/g, "")), wire);
});

test("a WOD logged counts too, and a second workout the same day sends nothing new", async () => {
  const r = recorder();
  const window = await bootApp({ beforeScripts: r.beforeScripts });
  await tick(100);
  window.choosePickedWod("fran");
  window.document.querySelector("[data-action='switch-tab'][data-tab='wod']").click();
  window.applyFieldValue("wod-step", "wodMinutes", 5);
  answerWodRx(window);
  await window.saveWod();
  await tick(80);
  window.choosePickedMovement("deadlift");
  window.applyFieldValue("step", "weight", 120);
  window.applyFieldValue("step", "reps", 3);
  await window.saveSet();
  await tick(80);
  assert.equal(bodies(r.calls).filter((b) => b.event === "workout_logged").length, 1, "once a day per device: that is all the report reads");
  assert.equal(bodies(r.calls).filter((b) => b.event === "screen_open" && b.screen === "wod").length, 1, "the WOD screen was opened");
});

test("an edit is not a workout", async () => {
  const r = recorder();
  const window = await bootApp({ beforeScripts: r.beforeScripts, localStorage: { "haimunia:usageSentDays": "{}" } });
  await tick(100);
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 60); window.applyFieldValue("step", "reps", 5);
  await window.saveSet(); await tick(80);
  r.calls.length = 0;
  window.localStorage.removeItem("haimunia:usageSentDays");
  const entry = window.entriesFor("back-squat")[0];
  await window.startEditEntry(entry.id);
  window.applyFieldValue("step", "weight", 62.5);
  await window.saveSet(); await tick(80);
  assert.equal(bodies(r.calls).filter((b) => b.event === "workout_logged").length, 0);
});

test("switched off in Settings: no request at all, and the device id is forgotten", async () => {
  const r = recorder();
  const window = await bootApp({ beforeScripts: r.beforeScripts });
  await tick(100);
  assert.ok(window.localStorage.getItem("haimunia:usageDeviceId"));
  window.openSettings();
  await tick(30);
  const off = window.document.querySelector("[data-action='set-usage-counting'][data-pref='off']");
  assert.ok(off, "the switch is in Settings");
  off.click();
  await tick(30);
  assert.equal(window.localStorage.getItem("haimunia:usageDeviceId"), null, "the id is gone");
  r.calls.length = 0;
  window.document.querySelector("[data-action='switch-tab'][data-tab='history']").click();
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 60); window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await tick(100);
  assert.deepEqual(r.calls, [], "nothing leaves the phone");
});

test("off survives a reload, and the app works completely with it off", async () => {
  const r = recorder();
  const window = await bootApp({ beforeScripts: r.beforeScripts, localStorage: { "haimunia:usageCountingOff": "1" } });
  await tick(100);
  window.choosePickedMovement("back-squat");
  window.applyFieldValue("step", "weight", 60); window.applyFieldValue("step", "reps", 5);
  await window.saveSet();
  await tick(80);
  assert.deepEqual(r.calls, []);
  assert.equal(window.entriesFor("back-squat").length, 1, "the workout saved");
});

test("offline, a server error, or a network that throws: silent, and the app carries on", async () => {
  for (const respond of [
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => Promise.resolve({ ok: false, status: 500 }),
    () => { throw new Error("synchronous throw"); },
  ]) {
    const r = recorder(respond);
    const errors = [];
    const window = await bootApp({
      beforeScripts: (w) => { r.beforeScripts(w); w.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason))); w.addEventListener("error", (e) => errors.push(e.message)); },
    });
    await tick(100);
    window.choosePickedMovement("back-squat");
    window.applyFieldValue("step", "weight", 60); window.applyFieldValue("step", "reps", 5);
    await window.saveSet();
    await tick(80);
    assert.equal(window.entriesFor("back-squat").length, 1, "the save is untouched by the count failing");
    assert.deepEqual(errors, [], "nothing surfaces");
  }
});

test("a count that could not be sent is tried once more later, not lost and not looped", async () => {
  let online = false;
  const r = recorder(() => (online ? Promise.resolve({ ok: true, status: 201 }) : Promise.reject(new TypeError("offline"))));
  const window = await bootApp({ beforeScripts: r.beforeScripts });
  await tick(100);
  const firstTry = r.calls.length;
  assert.ok(firstTry >= 1);
  online = true;
  window.document.querySelector("[data-action='switch-tab'][data-tab='calendar']").click();
  await tick(100);
  const retried = bodies(r.calls.slice(firstTry)).map((b) => b.event).sort();
  assert.ok(retried.includes("app_open"), `the failed app_open went out with the next count: ${retried}`);
  const pending = JSON.parse(window.localStorage.getItem("haimunia:usagePending") || "[]");
  assert.deepEqual(pending, [], "and nothing is left waiting");
});

test("Settings says what is counted, that the id links one phone's days, the IP logs, and 180 days", async () => {
  const window = await bootApp({ beforeScripts: recorder().beforeScripts });
  window.openSettings();
  await tick(30);
  const text = window.document.getElementById("settingsBody").textContent;
  assert.ok(text.includes("ספירת שימוש"), "the row is there");
  assert.match(text, /פתיחת האפליקציה, רישום אימון ופתיחת מסך/, "it names the three facts");
  assert.match(text, /מזהה אקראי קבוע של הטלפון/, "it names the id");
  assert.match(text, /מקשר את הספירות של הטלפון הזה לאורך הימים/, "pseudonymous: it says the id links days");
  assert.match(text, /יומני השרת שומרים את כתובת ה־IP לזמן קצר/, "it names the IP in request logs");
  assert.match(text, /נמחקות אחרי 180 יום/, "it states the retention");
  assert.doesNotMatch(text, /אנונימי/, "it does not claim anonymity");
});

test("the privacy page says the same: pseudonymous, linked across days, IP logs, 180 days, totals only", () => {
  const html = read("privacy.html");
  const section = html.slice(html.indexOf('id="usage-counting"'), html.indexOf("</section>", html.indexOf('id="usage-counting"')));
  assert.match(section, /המזהה הוא כינוי, לא אנונימיות מלאה/);
  assert.match(section, /מקשר את\s+הספירות של טלפון אחד לאורך הימים/);
  assert.match(section, /יומני הבקשות של ספק השרת \(Supabase\) שומרים\s+אותם לזמן קצר/);
  assert.match(section, /נמחקת אוטומטית אחרי 180 יום/);
  assert.match(section, /אף אחד לא רואה את השורות עצמן, גם לא צוות המועדון/);
  assert.doesNotMatch(html, /אנונימי(?!ות מלאה)/, "nowhere claims the counts are anonymous");
  assert.match(html, /עודכן לאחרונה: 23 בספטמבר 2026/);
});

test("the CSP opens exactly one origin, for this endpoint, and only for connect", () => {
  const html = read("index.html");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const cfg = read("app-config.js").match(/url: "([^"]+)"/)[1];
  const hosts = [...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]);
  assert.deepEqual(hosts, [cfg], csp);
  assert.match(csp, new RegExp(`connect-src 'self' ${cfg.replace(/[.]/g, "\\.")};`));
});

test("the config carries only the publishable key - never a secret", () => {
  const cfg = read("app-config.js");
  assert.match(cfg, /key: "sb_publishable_[A-Za-z0-9_-]+"/);
  assert.doesNotMatch(cfg, /service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/);
});
