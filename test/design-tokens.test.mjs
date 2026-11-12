// ONE TOKEN SOURCE (2026-11-12). Every color the app draws is defined once, in
// index.html's <style id="tokens">: primitives named by value (--p-*), semantic
// tokens on :root (light) and on :root[data-scheme="dark"] (dark). Everything
// else reaches a color through var(--...). data-scheme is the resolved scheme,
// stamped by theme-init.js and applyThemePref(), so dark exists once instead of
// twice (once under prefers-color-scheme, once under data-theme="dark"), which
// is how a contrast fix once landed in one copy and not the other.
//
// Replaces brass-contrast.test.mjs and theme-token-parity.test.mjs: the contrast
// checks move here and run on the resolved tokens; the parity check is moot
// because there is one copy.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = read("index.html");
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/;

function tokensBlock() {
  const m = html.match(/<style id="tokens">([\s\S]*?)<\/style>/);
  assert.ok(m, 'index.html has a <style id="tokens">');
  return m[1].replace(/\/\*[\s\S]*?\*\//g, "");
}
function declarations(css, selector) {
  const out = {};
  const re = new RegExp(selector.replace(/[[\]().*+?^$|\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g");
  for (const m of css.matchAll(re)) for (const d of m[1].matchAll(/--([a-z0-9_-]+)\s*:\s*([^;]+);/gi)) out[d[1]] = d[2].trim();
  return out;
}
/** Resolved token values for one scheme. */
function scheme(dark) {
  const css = tokensBlock();
  const light = declarations(css, ":root");
  const all = dark ? { ...light, ...declarations(css, ':root[data-scheme="dark"]') } : light;
  const resolve = (v, depth = 0) => v.replace(/var\(--([a-z0-9_-]+)\)/gi, (_, n) => {
    assert.ok(depth < 8 && n in all, `--${n} is defined in the token block`);
    return resolve(all[n], depth + 1);
  });
  const out = {};
  for (const [k, v] of Object.entries(all)) out[k] = resolve(v);
  return out;
}
function lum(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("text tokens clear WCAG 2.2 AA (4.5:1) on --surface and --bg, in light and in dark", () => {
  for (const dark of [false, true]) {
    const t = scheme(dark);
    for (const fg of ["chalk", "steel", "brass"]) {
      for (const bg of ["surface", "bg"]) {
        assert.match(t[fg] || "", /^#[0-9a-fA-F]{6}$/, `${dark ? "dark" : "light"} --${fg} resolves to a hex`);
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, `${dark ? "dark" : "light"} --${fg} (${t[fg]}) on --${bg} (${t[bg]}) is ${r.toFixed(2)}:1, below 4.5:1`);
      }
    }
  }
});

test("dark is written once: no prefers-color-scheme rule, and no data-theme selector in any stylesheet", () => {
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.doesNotMatch(css, /\[data-theme=/, "rules key on the resolved data-scheme, never on the choice");
  assert.equal((tokensBlock().match(/:root\[data-scheme="dark"\]\s*\{/g) || []).length >= 1, true);
});

test("no color literal outside the token block: other CSS, inline style attributes, app.js and src/*.js", () => {
  const rest = html.replace(/<style id="tokens">[\s\S]*?<\/style>/, "");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\((?:[^()]|\([^)]*\))*\)/g, "url()");
  for (const m of rest.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const bad = strip(m[1]).split("\n").filter((l) => !/@font-face/.test(l) && LITERAL.test(l));
    assert.deepEqual(bad, [], "a color in a stylesheet outside the token block");
  }
  const body = rest.slice(rest.indexOf("</head>"));
  const attrs = [...body.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).filter((v) => LITERAL.test(strip(v)));
  assert.deepEqual(attrs, [], "a color in an inline style attribute");
  const files = ["app.js", ...readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => "src/" + f)];
  for (const f of files) {
    const bad = read(f).split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l.split(" // ")[0])
      .filter((l) => LITERAL.test(strip(l)));
    assert.deepEqual(bad, [], `${f} names a color instead of a token`);
  }
});

test("the resolved scheme is stamped before first paint and kept in step with the choice and the OS", () => {
  const init = read("theme-init.js");
  assert.match(init, /setAttribute\("data-scheme", scheme\)/);
  assert.match(init, /prefers-color-scheme: dark/);
  const app = read("app.js");
  assert.match(app, /root\.setAttribute\("data-scheme", resolvedTheme\(\)\);/);
  assert.match(app, /if \(themePref === "auto"\) applyThemePref\(\);/, "an OS switch in auto mode re-stamps the scheme");
  assert.match(app, /getPropertyValue\("--meta-theme-color"\)/, "the browser bar color comes from the tokens");
});
