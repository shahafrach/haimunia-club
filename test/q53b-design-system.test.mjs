// Q-53 part 2: one primary button (solid, full strength, every primary style reads --btn-primary-*), בחירת תרגיל
// as the full-width primary on the empty רישום screen with a shorter photo, one EmptyState component, and
// radius/space tokens where the value is on the scale.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp } from "./helpers/boot.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = html.slice(html.indexOf("</style>", html.indexOf('<style id="tokens">')), html.indexOf("</head>"));
const rule = (sel) => { const i = css.lastIndexOf(sel + "{"); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };

test("every primary style reads the one primary token set; no translucent primary left", () => {
  for (const sel of ["  .save-btn", "  .chip-btn.primary", "  body[data-scene] #bottomBar .save-btn", '  body[data-scene="scene-page--add"] #bottomBar .save-btn', "  .pick-hero-cta"]) {
    assert.match(rule(sel), /background:var\(--btn-primary-bg\)/, sel);
  }
  assert.doesNotMatch(css, /#bottomBar \.save-btn\{[^}]*-a(75|68)\)/, "the glass fill is gone");
});

test("empty רישום: בחירת תרגיל is a full-width 52px primary and the photo is shorter until a movement is chosen", async () => {
  assert.match(rule("  .pick-hero-cta"), /flex:1 1 100%; min-height:var\(--btn-height-lg\)/);
  assert.match(css, /\.scene-page--add:has\(\.pick-hero\)\{ --scene-photo-height: clamp\(200px, 30svh, 280px\); \}/);
  const w = await bootApp();
  w.saveWelcomeForm("רונית");
  assert.ok(w.document.querySelector(".scene-page--add .exercise-select.pick-hero .pick-hero-cta"));
});

test("one EmptyState: the empty day, calendar day, chart, notifications and club feed all render .empty-state", async () => {
  const w = await bootApp();
  w.saveWelcomeForm("רונית");
  const day = w.document.querySelector(".day-empty");
  assert.ok(day && day.classList.contains("empty-state"), "empty day keeps its old name on the component");
  assert.equal(w.emptyStateHtml("א<b>", { cls: "x", icon: "<i></i>" }), '<div class="empty-state x"><i></i><span>א<b></span></div>');
  assert.doesNotMatch(css, /\n  \.empty\{|\n  \.day-empty\{/, "the old names carry no look of their own");
  const club = fs.readFileSync(new URL("../src/club.js", import.meta.url), "utf8");
  assert.match(club, /emptyStateHtml\("עוד אין פוסטים במועדון\."\)/);
});

test("radius and gap values on the scale are tokens", () => {
  assert.doesNotMatch(css, /(?<![-\w])border-radius:\s*(8|12|16|999)px\s*[;}]/);
  assert.doesNotMatch(css, /(?<![-\w])gap:\s*(4|8|12|16|24|32)px\s*[;}]/);
});
