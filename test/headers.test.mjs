// CLOUDFLARE PAGES SECURITY HEADERS (_headers). The header CSP must be the page's own <meta> CSP plus
// frame-ancestors (which only a header can carry), name only the origins the app really uses, and the
// file must stay inside Cloudflare's limits (100 rules, 2,000 characters a line).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");
const headersFile = read("_headers");

// { "/*": { "Header-Name": "value" } }
function parse(text) {
  const rules = {}; let cur = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = line.trim(); rules[cur] = rules[cur] || {}; continue; }
    const i = line.indexOf(":");
    rules[cur][line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}
const rules = parse(headersFile);
const directives = (csp) => Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(" ")]; }));
const metaCsp = directives(read("index.html").match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]);
const headerCsp = directives(rules["/*"]["Content-Security-Policy"]);

test("the header CSP is the meta CSP plus frame-ancestors 'none', nothing else differs", () => {
  const { "frame-ancestors": fa, ...rest } = headerCsp;
  const { "frame-ancestors": metaFa, ...metaRest } = metaCsp;
  assert.equal(fa, "'none'");
  assert.deepEqual(rest, metaRest);
  assert.equal(metaFa, "'none'", "the meta copy keeps its own, as a backstop");
});

test("only this app, the Supabase project and Turnstile are named; no inline script, eval, wildcard or http", () => {
  const supabase = read("app-config.js").match(/supabaseUrl: "(https:\/\/[^"]+)"/)[1];
  assert.equal(headerCsp["connect-src"], `'self' ${supabase}`);
  assert.equal(headerCsp["script-src"], "'self' https://challenges.cloudflare.com");
  assert.equal(headerCsp["frame-src"], "https://challenges.cloudflare.com");
  assert.equal(headerCsp["default-src"], "'self'");
  const all = rules["/*"]["Content-Security-Policy"];
  assert.doesNotMatch(all, /unsafe-eval|\*|http:\/\//, all);
  const inline = Object.entries(headerCsp).filter(([, v]) => v.includes("'unsafe-inline'")).map(([k]) => k);
  assert.deepEqual(inline, ["style-src"], "inline is allowed for styles only, never scripts");
  assert.equal(headerCsp["object-src"], "'none'");
  assert.equal(headerCsp["base-uri"], "'none'");
  assert.equal(headerCsp["form-action"], "'none'");
});

test("the other security headers are all there", () => {
  const h = rules["/*"];
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.match(h["Strict-Transport-Security"], /max-age=31536000/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Referrer-Policy"], "no-referrer");
  assert.match(h["Permissions-Policy"], /camera=\(\)/);
  assert.match(h["Permissions-Policy"], /microphone=\(\)/);
  assert.match(h["Permissions-Policy"], /geolocation=\(\)/);
  assert.equal(h["Cross-Origin-Opener-Policy"], "same-origin");
});

test("the page and the service worker are always revalidated; assets are left to the default", () => {
  for (const p of ["/", "/index.html", "/sw.js"]) assert.equal(rules[p]["Cache-Control"], "no-cache", p);
  assert.equal(rules["/*"]["Cache-Control"], undefined);
});

test("inside Cloudflare's limits, and not precached or listed as an app file", () => {
  assert.ok(Object.keys(rules).length + Object.values(rules).reduce((n, r) => n + Object.keys(r).length, 0) <= 100);
  for (const line of headersFile.split("\n")) assert.ok(line.length <= 2000);
  assert.doesNotMatch(read("sw.js"), /_headers/);
});
