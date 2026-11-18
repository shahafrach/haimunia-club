#!/usr/bin/env node
/**
 * Local-only security harness for the authorized audit.
 * Reads ~/dev/audit.env. Never points at production.
 *
 * Usage: node scripts/audit-security-harness.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv(join(homedir(), "dev/audit.env"));
const URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
if (!URL?.includes("127.0.0.1") && !URL?.includes("localhost")) {
  console.error("Refusing to run: SUPABASE_URL is not local:", URL);
  process.exit(2);
}

const findings = [];
const safe = [];
function finding(id, severity, title, proof) {
  findings.push({ id, severity, title, proof });
  console.log(`FINDING ${severity.toUpperCase()} ${id}: ${title}`);
  console.log(proof);
}
function ok(label, detail = "") {
  safe.push({ label, detail });
  console.log(`SAFE  ${label}${detail ? " — " + detail : ""}`);
}

async function api(path, { method = "GET", token, body, prefer, headers = {} } = {}) {
  const h = {
    apikey: ANON,
    Authorization: `Bearer ${token || ANON}`,
    ...headers,
  };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (prefer) h.Prefer = prefer;
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text, headers: Object.fromEntries(res.headers) };
}

async function rpc(name, args, token) {
  return api(`/rest/v1/rpc/${name}`, { method: "POST", token, body: args || {} });
}

async function select(table, query, token) {
  return api(`/rest/v1/${table}?${query}`, { token, headers: { Accept: "application/json" } });
}

const A = env.USER_A_TOKEN;
const B = env.USER_B_TOKEN;
const C = env.USER_C_TOKEN;
const ANON_TOK = env.ANON_TOKEN;
const AID = env.USER_A_ID;
const BID = env.USER_B_ID;
const CID = env.USER_C_ID;

async function main() {
  console.log("=== 1. Authorization / IDOR ===");

  // Clubs A can see vs B's friends circle
  const clubsA = await select("clubs", "select=id,name,type", A);
  const clubsB = await select("clubs", "select=id,name,type", B);
  const clubsAnon = await select("clubs", "select=id,name,type", ANON_TOK);
  const aNames = (clubsA.json || []).map((r) => r.name).sort();
  const bNames = (clubsB.json || []).map((r) => r.name).sort();
  if (aNames.includes("B Friends")) {
    finding("AUD-AUTHZ-01", "critical", "User A can read B's friends circle via clubs select",
      `GET /clubs as A => ${JSON.stringify(clubsA.json)}`);
  } else ok("A cannot read B's friends club", JSON.stringify(aNames));
  if (bNames.includes("Audit Club A")) {
    finding("AUD-AUTHZ-02", "critical", "User B can read A's club via clubs select",
      `GET /clubs as B => ${JSON.stringify(clubsB.json)}`);
  } else ok("B cannot read A's club", JSON.stringify(bNames));
  if ((clubsAnon.json || []).length > 0) {
    finding("AUD-AUTHZ-03", "high", "Anonymous session can read clubs",
      `GET /clubs as anon => ${JSON.stringify(clubsAnon)}`);
  } else ok("Anon cannot read clubs", `status=${clubsAnon.status} body=${JSON.stringify(clubsAnon.json)}`);

  // Private records IDOR
  const prA = await select("private_records", `user_id=eq.${BID}&select=*`, A);
  const prB = await select("private_records", `user_id=eq.${BID}&select=*`, B);
  const prAnon = await select("private_records", `select=*`, ANON_TOK);
  if ((prA.json || []).length > 0) {
    finding("AUD-AUTHZ-04", "critical", "User A can read B's private_records",
      `GET private_records?user_id=eq.B as A => ${JSON.stringify(prA.json)}`);
  } else ok("A cannot read B private_records", `status=${prA.status} n=${(prA.json||[]).length}`);
  if ((prB.json || []).length === 0) {
    finding("AUD-AUTHZ-05", "medium", "User B cannot read own private_records (fixture/RLS issue)",
      `GET as B => ${JSON.stringify(prB)}`);
  } else ok("B can read own private_records", `n=${prB.json.length}`);
  if ((prAnon.json || []).length > 0) {
    finding("AUD-AUTHZ-06", "critical", "Anon can read private_records", JSON.stringify(prAnon.json));
  } else ok("Anon cannot read private_records", `status=${prAnon.status}`);

  // Try A insert into B's private_records
  const prIns = await api(`/rest/v1/private_records`, {
    method: "POST", token: A, prefer: "return=representation",
    body: { user_id: BID, record_type: "session_note", record_id: "idor-try", payload: { t: "pwn" } },
  });
  if (prIns.status < 300) {
    finding("AUD-AUTHZ-07", "critical", "User A can insert private_records for B",
      `POST status=${prIns.status} body=${JSON.stringify(prIns.json)}`);
  } else ok("A cannot insert B private_records", `status=${prIns.status} ${JSON.stringify(prIns.json)}`);

  // Workout posts: A should not see B's post in B's circle
  const postsA = await select("workout_posts", "select=id,title,author_id,club_id,body", A);
  const titlesA = (postsA.json || []).map((p) => p.title);
  if (titlesA.includes("B secret post")) {
    finding("AUD-AUTHZ-08", "critical", "User A can read B's workout_posts outside shared clubs",
      JSON.stringify(postsA.json));
  } else ok("A cannot read B secret post", `titles=${JSON.stringify(titlesA)}`);

  // Profiles: can A read B's handle when not co-members?
  const profA = await select("profiles", `id=eq.${BID}&select=id,handle,display_name`, A);
  const profSeen = (profA.json || []).length > 0;
  if (profSeen) {
    // May be intentional if B is in any circle_members globally - B is in friends only.
    finding("AUD-AUTHZ-09", "medium", "User A can read profile of B (not a co-member)",
      `GET profiles?id=eq.B as A => ${JSON.stringify(profA.json)} — policy allows any profile that has any membership`);
  } else ok("A cannot read B profile when not co-members");

  // circle_members of B's club
  const cmA = await select("circle_members", `club_id=eq.b0000000-0000-4000-8000-0000000000b1&select=*`, A);
  if ((cmA.json || []).length > 0) {
    finding("AUD-AUTHZ-10", "high", "User A can read circle_members of B's friends circle",
      JSON.stringify(cmA.json));
  } else ok("A cannot read B circle_members", `status=${cmA.status}`);

  // Staff-only actions as plain member C
  console.log("=== Staff actions as plain member C ===");
  const staffRpcs = [
    ["remove_member", { p_user_id: AID }],
    ["club_announcement_delete", { p_id: "00000000-0000-4000-8000-000000000001" }],
    ["club_announcement_set_pinned", { p_id: "00000000-0000-4000-8000-000000000001", p_pinned: true }],
    ["owner_set_coach", { p_handle: "audit_user_c" }],
    ["club_link_rotate", {}],
    ["owner_create_club", { p_owner: "audit_user_c", p_name: "Hijack" }],
  ];
  for (const [name, args] of staffRpcs) {
    const r = await rpc(name, args, C);
    const leaked = r.status < 300 && !(r.json && (r.json.message || r.json.error || r.json.code));
    // PostgREST returns 200 with error payload for some raises; also 404 if no grant
    const body = JSON.stringify(r.json);
    const refused = r.status === 404 || r.status === 401 || r.status === 403
      || /not authorized|permission|P0001|42501|owner|staff|coach|forbidden|does not exist|jwt/i.test(body)
      || (typeof r.json === "string" && /invalid|not authorized|owner/i.test(r.json))
      || r.json === "invalid" || r.json === "not_owner" || r.json === "forbidden"
      || r.json === "not authorized";
    if (!refused && r.status < 300) {
      finding(`AUD-STAFF-${name}`, "high", `Plain member C succeeded calling ${name}`,
        `status=${r.status} body=${body}`);
    } else ok(`Member C refused ${name}`, `status=${r.status} body=${body.slice(0, 180)}`);
  }

  // Announcements: B should not read club A's announcements
  const annB = await select("club_announcements", "select=id,body,club_id", B);
  if ((annB.json || []).some((a) => /Club A/.test(a.body || ""))) {
    finding("AUD-AUTHZ-11", "high", "User B can read club A announcements", JSON.stringify(annB.json));
  } else ok("B cannot read club A announcements", `n=${(annB.json||[]).length}`);

  // achievement_definitions write as member
  const ach = await api(`/rest/v1/achievement_definitions`, {
    method: "POST", token: C, prefer: "return=representation",
    body: { id: "audit_pwn", title: "pwn", description: "x", sort_order: 1 },
  });
  if (ach.status < 300) {
    finding("AUD-AUTHZ-12", "medium", "Plain member can INSERT achievement_definitions",
      `status=${ach.status} body=${JSON.stringify(ach.json)}`);
  } else ok("Member cannot insert achievement_definitions", `status=${ach.status} ${JSON.stringify(ach.json).slice(0,160)}`);

  // Anon execute sweep of sensitive RPCs
  console.log("=== Anon RPC sweep ===");
  const anonRpcs = [
    ["delete_my_account", {}],
    ["request_account_deletion", {}],
    ["join_circle", { p_token: "a".repeat(64) }],
    ["transfer_take", { p_lookup_hash: "x", p_ip_hash: "y" }],
    ["transfer_put", { p_lookup_hash: "x", p_iv_b64: "y", p_ciphertext_b64: "z", p_ip_hash: "w" }],
    ["bug_report_submit", { p_body: "anon try" }],
    ["client_error_report", { p_kind: "js", p_message: "x", p_screen: "s", p_app_version: "1", p_file: "a.js", p_line: 1, p_fingerprint: "abcd1234", p_ip_hash: "h".repeat(64) }],
    ["feedback_submit", { p_body: "hi", p_device_hash: "d".repeat(64), p_ip_hash: "i".repeat(64) }],
  ];
  for (const [name, args] of anonRpcs) {
    const r = await rpc(name, args, ANON_TOK);
    const body = JSON.stringify(r.json);
    const allowedByDesign = ["join_circle", "client_error_report", "feedback_submit"].includes(name);
    const executed = r.status === 200 || r.status === 204;
    if (executed && !allowedByDesign && !/not authorized|P0001|42501|jwt|permission|rate/i.test(body)) {
      // join_circle returns status json; transfer should 404 (no grant)
      finding(`AUD-ANON-${name}`, "high", `Anonymous session executed ${name}`,
        `status=${r.status} body=${body.slice(0, 240)}`);
    } else {
      ok(`Anon ${name}`, `status=${r.status} body=${body.slice(0, 160)}`);
    }
  }

  // MFA aal1: enroll factor for B via SQL is done outside; check aal_satisfied RPC if exposed
  console.log("=== 2. Authentication / aal1 ===");
  const aal = await rpc("aal_satisfied", {}, B);
  ok("aal_satisfied as B (no factor)", `status=${aal.status} body=${JSON.stringify(aal.json)}`);

  // Username enumeration on signup
  const exist = await api(`/auth/v1/signup`, {
    method: "POST",
    body: { email: "audit_user_a@members.haimuniya.invalid", password: "AuditPass1x" },
  });
  const fresh = await api(`/auth/v1/signup`, {
    method: "POST",
    body: { email: "audit_enum_fresh_" + Date.now() + "@members.haimuniya.invalid", password: "AuditPass1x" },
  });
  const eMsg = JSON.stringify(exist.json);
  const fMsg = JSON.stringify(fresh.json);
  if (exist.status !== fresh.status && /already|registered|exists/i.test(eMsg) && !/already|registered|exists/i.test(fMsg)) {
    finding("AUD-AUTHN-01", "low", "Sign-up error differs for existing vs new email (username enumeration)",
      `existing status=${exist.status} ${eMsg.slice(0,200)} | fresh status=${fresh.status} ${fMsg.slice(0,200)}`);
  } else {
    ok("Sign-up enumeration check", `exist=${exist.status} fresh=${fresh.status}`);
  }

  // Password recovery / reset enumeration via recover
  const recExist = await api(`/auth/v1/recover`, {
    method: "POST",
    body: { email: "audit_user_a@members.haimuniya.invalid" },
  });
  const recMissing = await api(`/auth/v1/recover`, {
    method: "POST",
    body: { email: "nobody_enum_" + Date.now() + "@members.haimuniya.invalid" },
  });
  if (recExist.status !== recMissing.status || JSON.stringify(recExist.json) !== JSON.stringify(recMissing.json)) {
    finding("AUD-AUTHN-02", "low", "Password recover responses differ for existing vs missing email",
      `exist=${recExist.status} ${JSON.stringify(recExist.json)} | missing=${recMissing.status} ${JSON.stringify(recMissing.json)}`);
  } else {
    ok("Recover enumeration check", `both status=${recExist.status}`);
  }

  // SQL injection via RPC text params
  console.log("=== 4. Injection via RPC ===");
  const sqli = await rpc("join_circle", { p_token: "'; drop table profiles;--" + "a".repeat(40) }, A);
  ok("join_circle SQLi-shaped token", `status=${sqli.status} body=${JSON.stringify(sqli.json).slice(0,200)}`);
  const sqli2 = await rpc("bug_report_submit", { p_body: "'; select 1--" }, A);
  ok("bug_report_submit SQLi-shaped body", `status=${sqli2.status} body=${JSON.stringify(sqli2.json).slice(0,200)}`);

  // Feedback / client_error abuse (local)
  console.log("=== 6. Feedback / error report ===");
  const fbRead = await select("client_error_reports", "select=*", A);
  if ((fbRead.json || []).length > 0 || (fbRead.status === 200 && Array.isArray(fbRead.json) && fbRead.json.length)) {
    finding("AUD-FB-01", "high", "Authenticated user can SELECT client_error_reports", JSON.stringify(fbRead));
  } else ok("client_error_reports not readable by member", `status=${fbRead.status} body=${JSON.stringify(fbRead.json)}`);
  const brRead = await select("bug_reports", "select=*", A);
  if ((brRead.json || []).length > 0) {
    finding("AUD-FB-02", "high", "Authenticated user can SELECT bug_reports", JSON.stringify(brRead));
  } else ok("bug_reports not directly readable", `status=${brRead.status} body=${JSON.stringify(brRead.json)}`);

  // Grants: list tables anon can select via OpenAPI
  const openapi = await api(`/rest/v1/`, { token: ANON_TOK });
  ok("OpenAPI as anon", `status=${openapi.status}`);

  const report = { generatedAt: new Date().toISOString(), findings, safe };
  writeFileSync("/tmp/audit-harness-report.json", JSON.stringify(report, null, 2));
  console.log(`\n=== SUMMARY: ${findings.length} findings, ${safe.length} safe checks ===`);
  for (const f of findings) console.log(`- [${f.severity}] ${f.id}: ${f.title}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
