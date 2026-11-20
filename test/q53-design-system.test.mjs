// Q-53 (continues Q-44): the design system applied. No px font-size anywhere the app styles text (index.html,
// app.js, src/*.js): the --fs-* rem tokens, so iOS Dynamic Type moves them. A title scrim behind the photo
// titles; AA for the selected Rx chips, the WOD board label, placeholders and field borders; --club-coral split
// into accent / selected / focus ring; Rubik 900 and the BOX-LOG leftover CSS removed; the header has a height
// token and the progress card sits in the sheet; px sheet heights account for the large-text zoom.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("index.html"), app = read("app.js");
const src = fs.readdirSync(new URL("../src", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => read("src/" + f)).join("\n");

test("no px font-size: every size is a rem token (one narrow-bar exception, in rem too)", () => {
  for (const [name, t] of [["index.html", html], ["app.js", app], ["src/*.js", src]]) {
    assert.deepEqual(t.match(/font-size:\s*[0-9.]+px/g) || [], [], name);
  }
  for (const k of ["fs-caption", "fs-1", "fs-2", "fs-3", "fs-4", "fs-5", "fs-6", "fs-display"]) assert.match(html, new RegExp(`--${k}:[0-9.]+rem;`), k);
});

test("hero titles have a scrim; the subtitle is not dimmed", () => {
  assert.match(html, /--hero-title-scrim:linear-gradient\(to top,/); // Q-62: a band, not a radial blob
  assert.match(html, /\.scene-page__intro::before\{[^}]*background:var\(--hero-title-scrim\)/);
  assert.doesNotMatch(html, /\.scene-page__subtitle\{[^}]*opacity:\.92/);
});

test("contrast: selected Rx chips in --chalk, the board label gone, placeholders --steel, field borders --color-input-border", () => {
  for (const c of ["active-rx", "active-scaled", "active-plus"]) assert.match(html, new RegExp(`\\.rx-btn\\.${c}\\{[^}]*color:var\\(--chalk\\)`), c);
  assert.doesNotMatch(html, /\.wod-board-label/, "the WOD board was BOX-LOG's and is gone with its low-contrast label");
  assert.match(html, /::placeholder\{ color:var\(--steel\); opacity:1; \}/);
  assert.match(html, /\.text-input\{[^}]*border:1px solid var\(--color-input-border\)/);
});

test("--club-coral split: accent, selected and focus ring are their own tokens", () => {
  for (const k of ["color-accent", "color-selected", "color-focus-ring"]) assert.match(html, new RegExp(`--${k}:var\\(`), k);
  assert.match(html, /\.tabbtn\.active::before\{ background:var\(--color-selected\); \}/);
  assert.match(html, /:focus-visible \{ outline:2px solid var\(--color-focus-ring\)/);
});

test("Rubik 900 and the leftover BOX-LOG CSS are gone", () => {
  assert.doesNotMatch(html, /rubik-900/);
  assert.doesNotMatch(read("sw.js"), /rubik-900/);
  for (const c of ["post-card", "comment-row", "gd-root", "reaction-pill", "log-empty-head"]) assert.doesNotMatch(html, new RegExp(`\\.${c}[^a-zA-Z0-9_-]`), c);
});

test("header height token; the progress card is in the sheet; px sheet heights divide out the zoom", () => {
  assert.match(html, /--header-height:64px;/);
  assert.match(html, /height:var\(--header-height\)/);
  const hist = app.slice(app.indexOf("function renderHistoryTab() {"), app.indexOf("function renderHistoryTab() {") + 4000);
  assert.match(hist, /<div class="scene-sheet">\s*<div class="stripe-ribbon" aria-hidden="true"><\/div>\s*<div id="progressWho"/);
  assert.doesNotMatch(app, /style\.height = vh \+ "px"/);
  assert.match(app, /function pageZoom\(\)/);
});
