// 3.12.0: anonymous error reports (src/errors.js) and the feedback box (src/feedback.js).
// fetch is a stub in every test: nothing leaves the test (the same rule as test/usage-counting.test.mjs).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp, waitFor } from "./helpers/boot.mjs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const $ = (w, s) => w.document.querySelector(s);

async function boot(opts = {}) {
  const calls = [];
  const state = { ok: opts.ok !== false, offline: !!opts.offline, status: opts.status || 204 };
  const window = await bootApp({
    localStorage: opts.localStorage,
    beforeScripts: (w) => {
      w.scrollTo = () => {};
      w.fetch = async (url, init) => {
        calls.push({ url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null });
        if (!state.ok) throw new TypeError("Failed to fetch");
        return { ok: state.status < 300, status: state.status, json: async () => null };
      };
      Object.defineProperty(w.navigator, "onLine", { configurable: true, get: () => !state.offline });
    },
  });
  const welcome = window.document.getElementById("welcomeOverlay");
  if (welcome.classList.contains("open")) {
    window.document.getElementById("welcomeNameInput").value = "דנה";
    $(window, "[data-action='save-user-name']").click();
    await waitFor(() => !welcome.classList.contains("open"));
  }
  const rpc = (name) => calls.filter((c) => c.url.endsWith("/rest/v1/rpc/" + name));
  return { window, calls, state, rpc };
}

// ---- error reports ---------------------------------------------------------------------------------------
test("the message is cleaned of anything a member could have typed", async () => {
  const { window } = await boot();
  const s = window.HaimuniaErrors.sanitize;
  assert.equal(s(`Cannot read properties of undefined (reading 'דנה')`), "Cannot read properties of undefined (reading )");
  assert.equal(s(`Unexpected token 'a', "my squat 100kg" is not valid JSON`), "Unexpected token , is not valid JSON", "Chrome's form has no colon: the quoted input goes");
  assert.equal(s("JSON.parse: unexpected character at line 1 column 2 of the JSON data"), "JSON.parse");
  assert.equal(s("failed to load https://example.com/x?name=dana now"), "failed to load now");
  assert.equal(s("שגיאה בשמירה של דנה TypeError"), "TypeError", "Hebrew never passes, quoted or not");
  assert.equal(s("x".repeat(500)).length, 200);
});

test("a report carries only the agreed fields, and names only this app's own files", async () => {
  const { window } = await boot();
  const err = new TypeError(`x is not a function ("דנה")`);
  const r = window.HaimuniaErrors.describe("error", err, { filename: window.location.origin + "/src/club.js", lineno: 12, colno: 3 });
  assert.deepEqual(Object.keys(r).sort(), ["p_app_version", "p_col", "p_file", "p_fp", "p_kind", "p_line", "p_message", "p_name", "p_screen"]);
  assert.equal(r.p_name, "TypeError");
  assert.equal(r.p_file, "club.js");
  assert.equal(r.p_message, "x is not a function ()");
  assert.match(r.p_fp, /^[0-9a-f]{8}$/);
  assert.equal(r.p_app_version, read("app.js").match(/^const APP_VERSION = "([^"]+)";/m)[1]);
  assert.equal(window.HaimuniaErrors.describe("error", err, { filename: "https://cdn.example/x.js" }).p_file, "other");
  assert.equal(window.HaimuniaErrors.describe("unhandledrejection", "boom", {}).p_kind, "unhandledrejection");
});

test("an uncaught error is sent to client_error_report, with the publishable key and no device id", async () => {
  const { window, rpc } = await boot();
  window.dispatchEvent(new window.ErrorEvent("error", { message: "boom", error: new RangeError("boom"), filename: window.location.origin + "/app.js", lineno: 9, colno: 1 }));
  await waitFor(() => rpc("client_error_report").length === 1);
  const c = rpc("client_error_report")[0];
  assert.equal(c.init.headers.apikey, window.HAIMUNIA_CONFIG.usage.key);
  assert.equal(c.init.credentials, "omit");
  assert.equal(c.body.p_kind, "error");
  assert.equal(c.body.p_name, "RangeError");
  assert.equal(c.body.p_file, "app.js");
  assert.ok(!("device_id" in c.body) && !("p_device" in c.body), "no device id in an error report");
});

test("a failed save is reported as kind storage", async () => {
  const { window, rpc } = await boot();
  const e = new Error("Quota hit for 'דנה'"); e.name = "QuotaExceededError";
  window.noteStorageError(e);
  await waitFor(() => rpc("client_error_report").length === 1);
  assert.equal(rpc("client_error_report")[0].body.p_kind, "storage");
  assert.equal(rpc("client_error_report")[0].body.p_name, "QuotaExceededError");
  assert.doesNotMatch(JSON.stringify(rpc("client_error_report")[0].body), /דנה/);
});

test("usage counting off means no reports, and what waited is dropped", async () => {
  const { window, rpc, state } = await boot({ offline: true });
  window.HaimuniaErrors.report("error", new Error("one"), {});
  await wait();
  assert.equal(JSON.parse(window.localStorage.getItem("haimunia:errorReportsPending")).length, 1, "offline: it waits");
  window.HaimuniaUsage.setOn(false);
  state.offline = false;
  await window.HaimuniaErrors.flush();
  window.HaimuniaErrors.report("error", new Error("two"), {});
  await wait();
  assert.equal(rpc("client_error_report").length, 0, "nothing is sent while off");
  assert.equal(window.localStorage.getItem("haimunia:errorReportsPending"), null, "and the queue is gone");
});

test("at most 5 a page load, one per fingerprint a day, 8 waiting offline", async () => {
  const { window, rpc, state } = await boot();
  for (let i = 0; i < 3; i++) await window.HaimuniaErrors.report("error", new Error("same"), {});
  assert.equal(rpc("client_error_report").length, 1, "the same error once");
  for (let i = 0; i < 10; i++) await window.HaimuniaErrors.report("error", new Error("err " + "x".repeat(i)), {});
  assert.equal(rpc("client_error_report").length, 5, "five a page load");
  // A new page load: the same fingerprint is not sent again today.
  const again = await boot({ localStorage: { "haimunia:errorReportDays": window.localStorage.getItem("haimunia:errorReportDays") } });
  await again.window.HaimuniaErrors.report("error", new Error("same"), {});
  assert.equal(again.rpc("client_error_report").length, 0, "once a day per fingerprint");
  // Offline queue: at most 8.
  const off = await boot({ offline: true });
  for (let i = 0; i < 12; i++) await off.window.HaimuniaErrors.report("error", new Error("q" + "y".repeat(i)), {});
  const q = JSON.parse(off.window.localStorage.getItem("haimunia:errorReportsPending"));
  assert.ok(q.length <= 8, "at most 8 wait (5 a page load reach the queue)");
  off.state.offline = false;
  off.window.dispatchEvent(new off.window.Event("online"));
  await waitFor(() => off.rpc("client_error_report").length === q.length);
  assert.equal(off.window.localStorage.getItem("haimunia:errorReportsPending"), null, "sent when the app is online, and the queue is gone");
  void state;
});

test("a report never throws, even when fetch itself throws", async () => {
  const { window } = await boot({ ok: false });
  assert.equal(await window.HaimuniaErrors.report("error", new Error("x"), {}), false);
  assert.ok(JSON.parse(window.localStorage.getItem("haimunia:errorReportsPending")).length === 1, "kept for later");
});

// ---- the feedback box ----------------------------------------------------------------------------------
async function openFromSettings(window) {
  window.openSettings();
  await wait();
  $(window, "#settingsBody [data-feedback-open]").click();
  await waitFor(() => window.document.getElementById("feedbackOverlay").classList.contains("open"));
}

test("Settings opens 'מה לא עובד טוב?' with a 1000-character box and a counter", async () => {
  const { window } = await boot();
  const row = $(window, "#settingsBody [data-feedback-open]");
  assert.ok(row && /שליחת משוב/.test(row.textContent), "a שליחת משוב row in Settings");
  await openFromSettings(window);
  assert.equal($(window, "#feedbackTitle").textContent, "מה לא עובד טוב?");
  const box = $(window, "#feedbackText");
  assert.equal(box.getAttribute("maxlength"), "1000");
  box.value = "הכפתור קטן";
  box.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal($(window, "#feedbackCount").textContent, "10/1000");
  assert.ok($(window, "[data-feedback='send']"));
});

test("sending posts only the text, screen, version, device type and the feedback id: no name, no username", async () => {
  const { window, rpc } = await boot({ localStorage: { "haimunia:connectChoice": "connected" } });
  await openFromSettings(window);
  $(window, "[data-feedback-screen='wod']").click();
  $(window, "#feedbackText").value = "  הטיימר קופץ  ";
  $(window, "[data-feedback='send']").click();
  await waitFor(() => rpc("feedback_submit").length === 1);
  const body = rpc("feedback_submit")[0].body;
  assert.deepEqual(Object.keys(body).sort(), ["p_app_version", "p_body", "p_device", "p_device_type", "p_screen", "p_standalone"]);
  assert.equal(body.p_body, "הטיימר קופץ");
  assert.equal(body.p_screen, "wod");
  assert.ok(["ios", "android", "desktop", "other"].includes(body.p_device_type));
  assert.match(body.p_device, /^[A-Za-z0-9-]{16,64}$/);
  assert.notEqual(body.p_device, window.localStorage.getItem("haimunia:usageDeviceId"), "not the usage-count id");
  assert.doesNotMatch(JSON.stringify(body), /דנה/, "the member's name is not sent");
  await waitFor(() => /תודה\. קראנו כל פנייה\./.test($(window, "#feedbackNote").textContent));
  assert.equal($(window, "#feedbackText").value, "", "the box is emptied");
});

test("offline: the message waits (5 at most), says so, and goes when the app is online", async () => {
  const { window, rpc, state } = await boot({ offline: true });
  await openFromSettings(window);
  for (let i = 1; i <= 5; i++) {
    $(window, "#feedbackText").value = "הודעה " + i;
    $(window, "[data-feedback='send']").click();
    await waitFor(() => /נשלח כשיהיה חיבור/.test($(window, "#feedbackNote").textContent) && $(window, "#feedbackText").value === "");
    $(window, "#feedbackNote").textContent = "";
  }
  assert.equal(JSON.parse(window.localStorage.getItem("haimunia:feedbackQueue")).length, 5);
  $(window, "#feedbackText").value = "השישית";
  $(window, "[data-feedback='send']").click();
  await waitFor(() => /כבר מחכות 5 הודעות/.test($(window, "#feedbackNote").textContent));
  assert.equal($(window, "#feedbackText").value, "השישית", "the sixth stays in the box");
  assert.equal(rpc("feedback_submit").length, 0);
  state.offline = false;
  window.dispatchEvent(new window.Event("online"));
  await waitFor(() => rpc("feedback_submit").length === 5);
  assert.deepEqual(rpc("feedback_submit").map((c) => c.body.p_body), ["הודעה 1", "הודעה 2", "הודעה 3", "הודעה 4", "הודעה 5"]);
  await waitFor(() => window.localStorage.getItem("haimunia:feedbackQueue") === "[]");
});

test("a failed send is kept and sent on the next start", async () => {
  const first = await boot({ ok: false });
  await openFromSettings(first.window);
  $(first.window, "#feedbackText").value = "לא נשלח";
  $(first.window, "[data-feedback='send']").click();
  await waitFor(() => /נשלח כשיהיה חיבור/.test($(first.window, "#feedbackNote").textContent));
  const queued = first.window.localStorage.getItem("haimunia:feedbackQueue");
  const next = await boot({ localStorage: { "haimunia:feedbackQueue": queued } });
  await waitFor(() => next.rpc("feedback_submit").length === 1);
  assert.equal(next.rpc("feedback_submit")[0].body.p_body, "לא נשלח");
});

test("3.14.0: opened from the Settings row, the sheet is about 'הגדרות', not the tab underneath", async () => {
  const { window } = await boot();
  window.document.getElementById("tabHistoryBtn").click();
  await wait();
  await openFromSettings(window);
  assert.equal($(window, "[data-feedback-screen='settings']").getAttribute("aria-checked"), "true");
  assert.equal($(window, "[data-feedback-screen='history']").getAttribute("aria-checked"), "false");
});

test("3.14.0: a 4xx refusal is not queued; the member is told and keeps the draft. 5xx, 408 and 429 wait", async () => {
  const { window, rpc, state } = await boot({ status: 400 });
  await openFromSettings(window);
  $(window, "#feedbackText").value = "טקסט שהשרת דחה";
  $(window, "[data-feedback='send']").click();
  await waitFor(() => /המשוב לא נשלח\. נסו לקצר או לנסח אחרת\./.test($(window, "#feedbackNote").textContent));
  assert.equal(rpc("feedback_submit").length, 1);
  assert.equal($(window, "#feedbackText").value, "טקסט שהשרת דחה", "the draft stays in the box");
  assert.ok(!$(window, "[data-feedback='send']").disabled, "and can be edited and sent again");
  assert.equal(JSON.parse(window.localStorage.getItem("haimunia:feedbackQueue") || "[]").length, 0, "nothing queued");
  for (const [status, n] of [[500, 1], [503, 2], [408, 3], [429, 4]]) {
    state.status = status;
    $(window, "#feedbackText").value = "שוב " + status;
    $(window, "[data-feedback='send']").click();
    await waitFor(() => JSON.parse(window.localStorage.getItem("haimunia:feedbackQueue") || "[]").length === n);
    await waitFor(() => /נשלח כשיהיה חיבור/.test($(window, "#feedbackNote").textContent));
  }
});

test("3.14.0: a queued message the server refuses is dropped, not retried at every start", async () => {
  const queued = JSON.stringify([{ p_app_version: "3.12.0", p_screen: "other", p_device_type: "other", p_standalone: false, p_body: "ישן", p_device: "abcdefabcdefabcdef" }]);
  const next = await boot({ status: 400, localStorage: { "haimunia:feedbackQueue": queued } });
  await waitFor(() => next.rpc("feedback_submit").length === 1);
  await waitFor(() => next.window.localStorage.getItem("haimunia:feedbackQueue") === "[]");
  const later = await boot({ localStorage: { "haimunia:feedbackQueue": next.window.localStorage.getItem("haimunia:feedbackQueue") } });
  await wait(100);
  assert.equal(later.rpc("feedback_submit").length, 0, "nothing left to send");
});

test("the storage error offers 'שליחת משוב' with that screen preselected", async () => {
  const { window } = await boot();
  window.noteStorageError(new Error("x"));
  window.render();
  const link = $(window, "#content [data-feedback-open]");
  assert.ok(link && /שליחת משוב/.test(link.textContent));
  link.click();
  await waitFor(() => window.document.getElementById("feedbackOverlay").classList.contains("open"));
  assert.equal($(window, "[data-feedback-screen='add']").getAttribute("aria-checked"), "true");
});

test("the club share-failure toasts carry the 'שליחת משוב' action", () => {
  const src = read("src/club.js");
  assert.match(src, /failToast\("השינוי נשמר בטלפון\. המועדון לא התעדכן הפעם\."\)/);
  assert.match(src, /failToast\("השיא נשמר בטלפון\. השיתוף במועדון לא הצליח הפעם\."\)/);
  assert.match(src, /showToast\(t, \{ label: "שליחת משוב", run: function \(\) \{ window\.HaimuniaFeedback\.open\("club"\); \} \}\)/);
});

// ---- wiring and the policy -----------------------------------------------------------------------------
test("errors.js loads right after usage.js; both new files are precached as optional", () => {
  const html = read("index.html");
  assert.match(html, /<script defer src="\.\/src\/usage\.js"><\/script>\n<script defer src="\.\/src\/errors\.js"><\/script>\n<script defer src="\.\/src\/feedback\.js"><\/script>/);
  const sw = read("sw.js");
  const optional = sw.slice(sw.indexOf("const OPTIONAL_ASSETS"), sw.indexOf("];", sw.indexOf("const OPTIONAL_ASSETS")));
  assert.match(optional, /"\.\/src\/errors\.js"/);
  assert.match(optional, /"\.\/src\/feedback\.js"/);
});

test("the privacy page has sections 6 and 7 as approved, the rest renumbered, Supabase named for both", () => {
  const html = read("privacy.html");
  const heads = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(heads.slice(6), ["5. ספירת שימוש", "6. דיווח שגיאות אוטומטי", "7. משוב", "8. דיווח על תקלה", "9. איפה המידע נשמר", "10. הזכויות שלכם", "11. שינויים במסמך"]);
  assert.match(html, /כשמשהו נכשל באפליקציה, נשלחים סוג השגיאה, תיאור טכני קצר בלי שום דבר שכתבתם, המסך וגרסת האפליקציה\. בלי מזהה, בלי שם ובלי נתוני יומן\. הדיווחים נמחקים אחרי 30 יום\. הם נשלחים רק כשספירת השימוש פועלת, וכיבוי ספירת השימוש מכבה גם אותם\./);
  assert.match(html, /מה שאתם כותבים בתיבת "מה לא עובד טוב\?" נשלח לשרת עם המסך, גרסת האפליקציה וסוג המכשיר\. בלי שם, בלי שם משתמש ובלי נתוני יומן, אלא אם כתבתם אותם בעצמכם\. רק מפעיל האפליקציה קורא את המשוב\. הוא נמחק אחרי 12 חודשים\./);
  assert.match(html, /השרת של מצב מחובר, קוד ההעברה, ספירת השימוש, דיווחי השגיאות והמשוב הוא Supabase/);
});
