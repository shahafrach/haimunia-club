// Regression: the auto-detected dark theme (@media prefers-color-scheme)
// and the explicit dark theme ([data-theme="dark"]) are two separate CSS
// blocks that must stay in sync - an earlier accessibility fix updated
// --steel's contrast-failing value in one and missed the other, so the
// app's own default (explicit dark, set by theme-init.js) kept shipping
// the un-fixed color while the auto-detected path silently had the real
// fix. Locks in that every color token defined in one dark block is
// defined identically in the other, not just that both blocks exist.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractTokens(block) {
  const tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) tokens[m[1]] = m[2].trim();
  return tokens;
}

test("the auto-detected dark theme block and the explicit [data-theme=\"dark\"] block define every color token identically", () => {
  const autoStart = html.indexOf('@media (prefers-color-scheme: dark)');
  const autoEnd = html.indexOf('}', html.indexOf('}', autoStart) + 1);
  const explicitStart = html.indexOf(':root[data-theme="dark"]');
  const explicitEnd = html.indexOf('}', explicitStart);

  assert.ok(autoStart > -1 && explicitStart > -1, "both dark-theme blocks must exist");

  const autoTokens = extractTokens(html.slice(autoStart, autoEnd));
  const explicitTokens = extractTokens(html.slice(explicitStart, explicitEnd));

  const autoKeys = Object.keys(autoTokens).filter((k) => k !== "color-scheme");
  assert.ok(autoKeys.length > 5, "sanity check: the extraction actually found real tokens");

  for (const key of autoKeys) {
    assert.equal(explicitTokens[key], autoTokens[key], `--${key} must match between the auto-detected and explicit dark theme blocks (auto: ${autoTokens[key]}, explicit: ${explicitTokens[key]})`);
  }
});
