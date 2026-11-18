/**
 * AUD-AAL-01 / F-028: password-only (aal1) session of a member with a verified MFA
 * factor must not run club staff SECURITY DEFINER RPCs.
 *
 * Runs only when ~/dev/audit.env exists (local Supabase + audit users). Normal CI
 * skips. Against the vulnerable backend this file fails; after the sibling fix
 * (aal_satisfied in remove_member, rotate_club_link, club_announcement_*) it passes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_PATH = join(homedir(), "dev/audit.env");
// Opt-in: normal `npm test` stays green. Prove the gap with:
//   AUDIT_LOCAL=1 node --test test/audit-aal1-staff-rpcs.test.mjs
const hasLocal = process.env.AUDIT_LOCAL === "1" && existsSync(ENV_PATH);

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function api(env, path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

test("aal1 staff RPCs are refused when the member has a verified MFA factor", { skip: !hasLocal }, async () => {
  const env = loadEnv(ENV_PATH);
  assert.match(env.SUPABASE_URL, /127\.0\.0\.1|localhost/, "audit.env must point at local Supabase only");

  const sign = await api(env, "/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: env.USER_A_EMAIL, password: env.AUDIT_PASS },
  });
  assert.equal(sign.status, 200, "sign-in A");
  const token = sign.json.access_token;
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(payload.aal, "aal1", "fixture must be password-only aal1");

  // Ensure a verified factor still exists (harness / prior runs may have left one).
  // If none, this assertion documents that the test needs MFA enrolled for A.
  const aal = await api(env, "/rest/v1/rpc/aal_satisfied", { method: "POST", token, body: {} });
  assert.equal(aal.status, 200);
  assert.equal(aal.json, false, "aal_satisfied must be false for this aal1+factor session");

  const clubId = "ede68226-ac89-446b-824f-0bf21e35eec7";
  const cases = [
    ["rotate_club_link", { p_club_id: clubId }],
    ["club_announcement_post", { p_club_id: clubId, p_body: "should-fail-aal1", p_pinned: false }],
    ["remove_member", { p_club_id: clubId, p_user_id: env.USER_C_ID }],
  ];

  const leaked = [];
  for (const [name, args] of cases) {
    const r = await api(env, `/rest/v1/rpc/${name}`, { method: "POST", token, body: args });
    const refused = r.status >= 400 || (r.json && /not authorized/i.test(JSON.stringify(r.json)));
    if (!refused) leaked.push({ name, status: r.status, body: r.json });
  }

  assert.deepEqual(
    leaked,
    [],
    "aal1 must not succeed on staff RPCs; got: " + JSON.stringify(leaked)
  );
});
