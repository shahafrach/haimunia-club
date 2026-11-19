// Q-61 (owner 2026-11-19, Settings screenshots of 3.20.0): one segmented control with a filled selected state;
// מתקדם is a card row with its sections inside; long explanations are one line + פרטים; the version and the update
// check are one small card at the very bottom; פרטיות is a row like מה חדש.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
async function settings() {
  const w = await bootApp();
  w.saveWelcomeForm("רונית");
  w.openSettings();
  return w;
}

test("every segmented control's selected state is the filled accent, never the gold outline", () => {
  for (const sel of ['.segmented-opt[aria-checked="true"]', ".subtabbtn.active", ".rx-btn.active-type"]) {
    const i = html.indexOf(`  ${sel}`);
    assert.ok(i >= 0, sel);
    const rule = html.slice(i, html.indexOf("}", i));
    assert.match(rule, /background:var\(--seg-selected-bg\)/, sel);
    assert.match(rule, /color:var\(--seg-selected-fg\)/, sel);
    assert.doesNotMatch(rule, /--brass/, `${sel}: no gold outline`);
  }
  assert.match(html, /\.segmented, #themeRow, #textScaleRow\{ display:flex; flex-wrap:wrap;/, "options wrap at large text instead of breaking a word");
});

test("מתקדם is a card: a summary row with a chevron, its sections inside the same card", async () => {
  const w = await settings();
  const adv = w.document.getElementById("settingsAdvanced");
  assert.ok(adv.classList.contains("settings-block"), "the fold is a card");
  const sum = adv.querySelector(":scope > summary");
  assert.ok(sum.classList.contains("settings-row-summary") && sum.querySelector(".settings-chevron"));
  const inner = [...adv.querySelectorAll(":scope > .settings-block")];
  assert.ok(inner.length >= 4 && inner.every((b) => b.classList.contains("settings-block--inner")), "sections are inside, not cards of their own");
});

test("usage counting, delete data and the backup note: one short line, the rest under פרטים", async () => {
  const w = await settings();
  const d = w.document;
  const check = (block, full) => {
    const more = block.querySelector("details.settings-more");
    assert.ok(more, "a פרטים disclosure");
    assert.equal(more.querySelector("summary").textContent, "פרטים");
    assert.ok(more.textContent.includes(full), "the full text is kept inside it");
    const visible = [...block.querySelectorAll(":scope > .footer-note")].map((n) => n.textContent.trim());
    assert.ok(visible.every((t) => t.length <= 60), `short visible lines: ${visible.join(" | ")}`);
  };
  check(d.getElementById("usageSettingsBlock"), "180 יום");
  check(d.querySelector("[data-action='ask-clear']").closest(".settings-block"), "כדי שתמיד תהיה דרך חזרה");
  check(d.querySelector("[data-action='export-data']").closest(".settings-block"), "JSON");
});

test("פרטיות is a row like מה חדש; the version and the update check are one card at the very bottom", async () => {
  const w = await settings();
  const d = w.document;
  const priv = d.querySelector("#settingsAdvanced a[href='./privacy.html']");
  assert.ok(priv.classList.contains("exercise-row") && !priv.classList.contains("link-btn"));
  const foot = d.getElementById("settingsFooter");
  assert.ok(foot.classList.contains("settings-block"));
  assert.ok(foot.querySelector("[data-action='check-update']") && /v\d+\.\d+\.\d+/.test(foot.textContent));
  assert.equal(d.querySelectorAll("[data-action='check-update']").length, 1, "one update check (the #62 hotfix stays fixed)");
});
