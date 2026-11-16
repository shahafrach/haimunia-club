// Support and bug reporting, reachable from the menu you already have open.
//
// Owner's instruction, 2026-09-17: "should be in the hamburger, so people will have easy access to report."
// Owner's request, 2026-11-16 (Q-27): that row opens the in-app feedback box (src/feedback.js,
// feedback_submit), not the old report that was copied or sent by WhatsApp or e-mail. There is one feedback
// screen: the menu row and the Settings row "שליחת משוב" both open it, with the screen the member came from
// preselected under "איפה זה קרה?". The automatic error reports are untouched.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { bootApp, waitFor } from "./helpers/boot.mjs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const $ = (w, s) => w.document.querySelector(s);
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function boot(opts = {}) {
  const calls = [];
  const state = { offline: !!opts.offline };
  const window = await bootApp({
    beforeScripts: (w) => {
      w.scrollTo = () => {};
      w.fetch = async (url, init) => {
        calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
        return { ok: true, status: 204, json: async () => null };
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
  const feedbackCalls = () => calls.filter((c) => c.url.endsWith("/rest/v1/rpc/feedback_submit"));
  return { window, state, feedbackCalls };
}
async function openNavMenu(window) {
  $(window, "#navMenuBtn, [data-action='open-nav-menu']").click();
  const overlay = window.document.getElementById("navMenuOverlay");
  assert.ok(overlay.classList.contains("open"), "the menu opened");
  return overlay;
}
const feedbackOpen = (w) => w.document.getElementById("feedbackOverlay").classList.contains("open");
const checked = (w) => $(w, "[data-feedback-screen][aria-checked='true']")?.getAttribute("data-feedback-screen");

test("the hamburger row opens the feedback box, closes the menu, and preselects the screen you came from", async () => {
  const { window } = await boot();
  window.document.getElementById("tabHistoryBtn").click();
  const menu = await openNavMenu(window);
  const row = menu.querySelector('[data-action="open-support"]');
  assert.match(row.textContent, /תמיכה ודיווח על תקלה/);
  row.click();
  await waitFor(() => feedbackOpen(window));
  assert.equal(window.document.getElementById("navMenuOverlay").classList.contains("open"), false, "the menu closed: no stacked sheets");
  assert.equal(checked(window), "history", "the screen you came from");
  const body = $(window, "#feedbackBody").textContent;
  assert.match(body, /מה לא עובד טוב, או מה היה עוזר לכם\?/);
  assert.match(body, /איפה זה קרה\? \(לא חובה\)/);
  assert.ok($(window, "#feedbackText") && $(window, "[data-feedback='send']"), "the text box and the send button");
});

test("sent from the menu: the text goes to feedback_submit, with the thank-you text", async () => {
  const { window, feedbackCalls } = await boot();
  const menu = await openNavMenu(window);
  menu.querySelector('[data-action="open-support"]').click();
  await waitFor(() => feedbackOpen(window));
  $(window, "#feedbackText").value = "הכפתור לא מגיב";
  $(window, "[data-feedback='send']").click();
  await waitFor(() => feedbackCalls().length === 1);
  assert.equal(feedbackCalls()[0].body.p_body, "הכפתור לא מגיב");
  assert.equal(feedbackCalls()[0].body.p_screen, "add");
  await waitFor(() => /תודה\. קראנו כל פנייה\./.test($(window, "#feedbackNote").textContent));
});

test("offline from the menu: it waits in the same queue and says so", async () => {
  const { window, state, feedbackCalls } = await boot({ offline: true });
  const menu = await openNavMenu(window);
  menu.querySelector('[data-action="open-support"]').click();
  await waitFor(() => feedbackOpen(window));
  $(window, "#feedbackText").value = "אין חיבור";
  $(window, "[data-feedback='send']").click();
  await waitFor(() => /נשלח כשיהיה חיבור/.test($(window, "#feedbackNote").textContent));
  assert.equal(JSON.parse(window.localStorage.getItem("haimunia:feedbackQueue")).length, 1);
  assert.equal(feedbackCalls().length, 0);
  state.offline = false;
  window.dispatchEvent(new window.Event("online"));
  await waitFor(() => feedbackCalls().length === 1);
});

test("from Settings: one row, 'שליחת משוב', to the same box, preselecting הגדרות; the old report is gone", async () => {
  const { window } = await boot();
  window.openSettings();
  await wait();
  const settings = window.document.getElementById("settingsOverlay");
  assert.equal(settings.querySelectorAll('[data-action="open-support"]').length, 0, "no second support row in Settings");
  const rows = settings.querySelectorAll("[data-feedback-open]");
  assert.equal(rows.length, 1, "one feedback row");
  assert.match(rows[0].textContent, /שליחת משוב/);
  rows[0].click();
  await waitFor(() => feedbackOpen(window));
  assert.equal(checked(window), "settings");
  // The menu row, opened while Settings is up, also says הגדרות.
  window.HaimuniaFeedback.close();
  window.openSupport();
  await waitFor(() => feedbackOpen(window));
  assert.equal(checked(window), "settings");
});

test("the desktop sidebar keeps the row, and it does not wear the Settings icon", async () => {
  const { window } = await boot();
  assert.ok(window.document.getElementById("desktopSidebar").querySelector('[data-action="open-support"]'));
  const menu = await openNavMenu(window);
  const settingsIcon = menu.querySelector('[data-action="open-settings"] svg');
  const supportIcon = menu.querySelector('[data-action="open-support"] svg');
  assert.notEqual(settingsIcon.innerHTML, supportIcon.innerHTML);
});

test("the WhatsApp, e-mail and copy report paths and their dialog are removed", () => {
  const app = read("app.js"), html = read("index.html"), cfg = read("app-config.js");
  for (const gone of ["supportOverlay", "supportSendWhatsApp", "supportSendEmail", "supportCopyReport", "supportReportText", "supportDiagnostics", "support-send-whatsapp", "support-send-email", "support-copy", "wa.me/", "close-support"]) {
    assert.ok(!app.includes(gone), `app.js still has ${gone}`);
    assert.ok(!html.includes(gone), `index.html still has ${gone}`);
  }
  assert.doesNotMatch(cfg, /supportWhatsApp|supportEmail/, "the routing config is gone too");
  assert.doesNotMatch(app, /mailto:/, "no mail handoff in the app");
});

test("privacy.html: section 8 says the bug report goes through the feedback box, with no WhatsApp or e-mail route", () => {
  const html = read("privacy.html");
  const s8 = html.slice(html.indexOf("<h2>8. דיווח על תקלה</h2>"), html.indexOf("<h2>9."));
  assert.match(s8, /דיווח על תקלה נשלח דרך תיבת המשוב באפליקציה/);
  assert.match(s8, /כמו שכתוב בסעיף 7/);
  assert.doesNotMatch(s8, /וואטסאפ|במייל|mailto|להעתיק/);
});
