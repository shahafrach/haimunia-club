// Q-52 (before pilot): mobile and PWA. The manifest starts at "./" (no 308) in any orientation; pinch-zoom is
// allowed; sheets stay under the status bar; one install-help component (src/connect.js haimuniaInstall) with
// in-app browsers (Android intent:// to Chrome), iOS 26, iOS Chrome/Firefox and iOS < 16.4, used by the iOS
// banner; the keyboard never covers a field in a sheet; the installed iPhone app says the club sign-in did not
// carry over from Safari and offers it. The passkey ceremony is in test/connect.test.mjs (Q-52 tests there).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const ua = (u) => (w) => Object.defineProperty(w.navigator, "userAgent", { value: u, configurable: true });
const IPHONE = (v, extra = "") => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${extra} Mobile/15E148 Safari/604.1`;

test("manifest: start_url and shortcuts at ./ (no /index.html redirect), orientation any", () => {
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.orientation, "any");
  for (const s of manifest.shortcuts) assert.doesNotMatch(s.url, /index\.html/);
});

test("pinch-zoom is allowed; double-tap zoom is off only on controls; sheets stay under the status bar", () => {
  assert.doesNotMatch(html, /html,body\{[^}]*touch-action:pan-y/);
  assert.match(html, /button, a, input, select, textarea, label, summary, \[role="button"\]\{ touch-action:manipulation; \}/);
  assert.match(html, /\.modal-sheet\{[^}]*max-height:min\(85%, calc\(100% - env\(safe-area-inset-top,0px\) - 12px\)\)/);
});

test("one install-help component: Telegram is an in-app browser, iOS Chrome after 16.4 has share steps, before it only Safari", async () => {
  const kinds = {};
  for (const [name, u] of [["tg", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/121 Mobile Safari/537.36 Telegram-Android/10.0"],
    ["crios", IPHONE("17_2", "CriOS/120.0")], ["crios-old", IPHONE("15_8", "CriOS/110.0")], ["ios26", IPHONE("26_1", "Version/26.1")]]) {
    const w = await bootApp({ beforeScripts: ua(u) });
    kinds[name] = [w.haimuniaInstall.kind(), w.haimuniaInstall.stepsHtml()];
  }
  assert.equal(kinds.tg[0], "inapp");
  assert.match(kinds.tg[1], /href="intent:\/\/[^"]*#Intent;scheme=https;package=com\.android\.chrome;end"/, "Android: one tap to Chrome");
  assert.match(kinds.tg[1], /Telegram/);
  assert.equal(kinds.crios[0], "ios-other");
  assert.match(kinds.crios[1], /הוספה למסך הבית/);
  assert.equal(kinds["crios-old"][0], "ios-old-other");
  assert.match(kinds["crios-old"][1], /רק מ-Safari/);
  assert.equal(kinds.ios26[0], "ios26");
  assert.match(kinds.ios26[1], /⋯/);
});

test("the iOS install banner's step 2 is the component's steps for this browser", async () => {
  const w = await bootApp({ beforeScripts: ua(IPHONE("26_1", "Version/26.1")) });
  w.maybeShowIOSInstallBanner();
  const how = w.document.getElementById("iosInstallHow");
  assert.ok(how.querySelector("ol.join-steps"), "the shared steps list");
  assert.equal(how.querySelector("[id^='connect']"), null, "without the join screen's ids");
  assert.match(how.textContent, /⋯/);
});

test("the installed iPhone app says the club sign-in did not carry over and offers it right there", async () => {
  const w = await bootApp({ beforeScripts: (win) => { ua(IPHONE("18_0", "Version/18.0"))(win); win.navigator.standalone = true; } });
  w.maybeOfferFirstImport();
  const box = w.document.getElementById("firstImportSignIn");
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /צריך להיכנס שוב/);
  let opened = null;
  w.haimuniaConnect.open = (v) => { opened = v; };
  box.querySelector("[data-action='first-import-signin']").click();
  assert.equal(opened, "login");
});

test("a field focused in a sheet is scrolled into view (the keyboard never covers it)", async () => {
  const w = await bootApp();
  w.saveWelcomeForm("רונית");
  w.openSettings();
  const input = w.document.createElement("input");
  w.document.getElementById("settingsBody").appendChild(input);
  let scrolled = 0;
  input.scrollIntoView = () => { scrolled++; };
  input.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(scrolled, 1);
});
