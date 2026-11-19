// Q-49 (Grok outside-in review, verified): install and join visible after the first-run sheet is skipped. A
// browser tab gets a compact install card on רישום (the one install-help component; one-tap install where the
// browser offers it; gone when installed, and on an iPhone only once the install dock was closed); a guest gets
// the join code field on רישום and on a מועדון tab (one component); the gear says הגדרות.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const $ = (w, s) => w.document.querySelector(s);
async function fresh(opts) { const w = await bootApp(opts); w.saveWelcomeForm("רונית"); w.document.getElementById("tabAddBtn").click(); return w; }

test("a browser tab: the install card on רישום with this browser's steps; not in the installed app", async () => {
  const w = await fresh();
  const card = $(w, "#content #installCard");
  assert.ok(card, "shown in a browser tab");
  assert.equal(card.tagName, "DETAILS", "folded: one line until opened");
  assert.ok(card.querySelector("ol.join-steps"), "the shared steps");
  assert.equal(card.querySelector("[id^='connect']"), null, "without the join screen's ids");
  const inst = await fresh({ beforeScripts: (win) => { win.navigator.standalone = true; } });
  assert.equal($(inst, "#installCard"), null, "gone in the installed app");
});

test("the one-tap install button shows where the browser offered it", async () => {
  const w = await fresh();
  w.dispatchEvent(Object.assign(new w.Event("beforeinstallprompt"), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) }));
  w.render();
  assert.ok($(w, "#installCard [data-action='install-app']"));
});

test("on an iPhone the dock is the install help; the card takes over once the dock was closed", async () => {
  const ua = (win) => Object.defineProperty(win.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", configurable: true });
  const w = await fresh({ beforeScripts: ua });
  assert.equal($(w, "#installCard"), null);
  w.localStorage.setItem("haimunia:iosInstallDismissed", "1");
  w.render();
  assert.ok($(w, "#installCard"));
});

test("a guest: the join code field on רישום; a code goes to joinWith, anything else gets a plain answer", async () => {
  const w = await fresh();
  const form = $(w, "#content form[data-join-inline='add']");
  assert.ok(form, "on רישום");
  form.querySelector("input[name='code']").value = "abcd-2345";
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  // joinWith(): not signed in, so the connect sheet opens on sign-up with the code kept for after it.
  assert.ok($(w, "#connectOverlay").classList.contains("open"), "the connect sheet opens");
  assert.ok($(w, "#connectBody form"), "on a form (sign-up)");
  w.haimuniaConnect.close();
  const again = $(w, "#content form[data-join-inline='add']"); // the screen re-rendered
  again.querySelector("input[name='code']").value = "hello";
  again.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  const err = again.querySelector(".join-card-err");
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /8 תווים/);
});

test("the gear says הגדרות, and is at least 44px", () => {
  assert.match(html, /<button id="settingsGearBtn"[^>]*>[\s\S]*?<span class="gear-label">הגדרות<\/span>/);
  assert.match(html, /#settingsGearBtn\{[^}]*min-width:52px; min-height:52px;/);
});
