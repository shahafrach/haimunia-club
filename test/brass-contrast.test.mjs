// COMM-361: light-theme --brass is used at 13-14px bold for PR/1RM stat
// values and (in Community) leaderboard/badge/priority text - real numeric
// data, not decoration - so it needs to clear the WCAG AA 4.5:1 floor for
// normal text against both surfaces it actually renders on (--surface and
// --bg). Computes the real relative-luminance contrast ratio from the
// tokens as shipped, so a future edit to any of these three tokens gets
// caught here instead of by eyeballing it.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractRootTokens() {
  const start = html.indexOf(":root{");
  const end = html.indexOf("}", start);
  const block = html.slice(start, end);
  const tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2];
  return tokens;
}

// Launch-readiness audit, A4. This file used to check ONE token in ONE
// theme. Two gaps behind that:
//   * --steel is the secondary-text colour used at 11-13.5 px throughout
//     cloud.js - timestamps, counts, hint lines, the outbox banner's own
//     detail text. It is smaller than --brass and was never checked at all.
//   * The dark theme was never checked in any form, despite being a real
//     shipped theme with its own token values.
// The dark palette lives in the @media (prefers-color-scheme: dark) block;
// the [data-theme="dark"] block re-states the same values for the explicit
// toggle, so checking the media block covers both.
function extractDarkTokens() {
  const i = html.indexOf("prefers-color-scheme: dark");
  const rootAt = html.indexOf(":root", i);
  const open = html.indexOf("{", rootAt);
  const close = html.indexOf("}", open);
  const tokens = {};
  for (const m of html.slice(open, close).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2];
  return tokens;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(hexA, hexB) {
  const [a, b] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("light-theme --brass clears 4.5:1 AA contrast against --surface and --bg", () => {
  const tokens = extractRootTokens();
  assert.ok(tokens.brass, "sanity check: --brass must be found in the light :root block");
  assert.ok(tokens.surface && tokens.bg, "sanity check: --surface and --bg must be found");

  const vsSurface = contrast(tokens.brass, tokens.surface);
  const vsBg = contrast(tokens.brass, tokens.bg);

  assert.ok(vsSurface >= 4.5, `--brass (${tokens.brass}) vs --surface (${tokens.surface}) is ${vsSurface.toFixed(2)}:1, below the 4.5:1 AA floor`);
  assert.ok(vsBg >= 4.5, `--brass (${tokens.brass}) vs --bg (${tokens.bg}) is ${vsBg.toFixed(2)}:1, below the 4.5:1 AA floor`);
});

test("light-theme --steel clears 4.5:1 AA against --surface and --bg", () => {
  const t = extractRootTokens();
  assert.ok(t.steel, "sanity check: --steel must be found in the light :root block");
  for (const bgName of ["surface", "bg"]) {
    const ratio = contrast(t.steel, t[bgName]);
    assert.ok(ratio >= 4.5,
      `--steel (${t.steel}) vs --${bgName} (${t[bgName]}) is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor - it renders secondary text at 11-13.5px throughout cloud.js`);
  }
});

test("dark-theme --brass and --steel both clear 4.5:1 AA against --surface and --bg", () => {
  const d = extractDarkTokens();
  assert.ok(d.brass && d.steel, "sanity check: dark --brass and --steel must be found");
  assert.ok(d.surface && d.bg, "sanity check: dark --surface and --bg must be found");
  for (const fg of ["brass", "steel"]) {
    for (const bgName of ["surface", "bg"]) {
      const ratio = contrast(d[fg], d[bgName]);
      assert.ok(ratio >= 4.5,
        `dark --${fg} (${d[fg]}) vs --${bgName} (${d[bgName]}) is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor`);
    }
  }
});

test("the explicit dark toggle re-states the same palette as the media query, so both paths are covered by the assertions above", () => {
  // [data-theme="dark"] exists so a member's explicit choice beats the OS
  // setting. If it ever drifts from the media block, the assertions above
  // would be testing a palette half the users never see.
  const i = html.indexOf('[data-theme="dark"]');
  assert.ok(i > 0, 'an explicit [data-theme="dark"] block must exist');
  const open = html.indexOf("{", i);
  const close = html.indexOf("}", open);
  const explicit = {};
  for (const m of html.slice(open, close).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) explicit[m[1]] = m[2];
  const media = extractDarkTokens();
  for (const key of ["brass", "steel", "surface", "bg"]) {
    if (explicit[key] === undefined) continue; // inherits from the media block
    assert.equal(explicit[key], media[key],
      `--${key} differs between [data-theme="dark"] (${explicit[key]}) and the prefers-color-scheme block (${media[key]}) - one of the two themes is untested`);
  }
});
