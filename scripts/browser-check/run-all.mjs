#!/usr/bin/env node
// Runs every check in sequence. See the header comment in each script for
// what it covers and why it exists.
//
// The script list is discovered from disk, not hand-maintained — a
// hardcoded list here silently stopped covering new checks (roadmap.mjs,
// text-scale.mjs, benchmarks.mjs all existed but were never run by this
// file). Any *.mjs file in this directory except this one and files
// under lib/ is treated as a check.
//
// COMM-333: this used to stop at the first failure, so one scenario
// failing (or a flaky console-error check) silently hid every scenario
// after it in the sort order from ever running that pass — a bad run and
// a partially-skipped run looked identical from the outside. It now runs
// every script regardless of earlier failures and reports the full set at
// the end; the exit code still reflects whether anything failed.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs")
  .sort();

// A STUCK SCRIPT MUST NOT BE ABLE TO STOP CI, and until 2026-09-17 it could.
//
// spawnSync with no timeout waits forever, and these scripts have two ways to
// never return. Every one of them starts a local HTTP server through
// resolveLocalOnlyTarget(), and an open server handle keeps node alive: a
// script that finishes normally without closing it hangs (verified, exit 124
// under a timeout), and so does any await that never settles - browser.close()
// on a wedged chromium being the usual one - since process.exit() is then
// never reached either. A script that simply THROWS is fine; node terminates
// on the rejected top-level await. The loud failure was never the problem.
//
// The browser-checks job sat in_progress for FOUR HOURS on 2026-09-17,
// reporting nothing, which is worse than a red build: a job that never
// finishes never tells anyone anything, and branch protection reads it as
// "expected" rather than "failed" - so the push goes through and the gate
// looks merely pending forever.
//
// Eight minutes is roughly four times the slowest real run on this machine.
// A script that needs longer than that has a problem worth surfacing, and
// SIGKILL rather than SIGTERM because the thing being killed is, by
// definition, not responding to its own shutdown path.
const PER_SCRIPT_TIMEOUT_MS = 8 * 60 * 1000;

const results = [];
for (const script of scripts) {
  console.log(`\n${"=".repeat(60)}\n${script}\n${"=".repeat(60)}`);
  const result = spawnSync(process.execPath, [path.join(here, script)], {
    stdio: "inherit",
    env: process.env,
    timeout: PER_SCRIPT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  // A timeout is reported as signal SIGKILL with a null status, which would
  // otherwise read as `exit null` and look like any other failure. Naming it
  // is the difference between "this check failed" and "this check never
  // answered", and those need different fixes.
  const timedOut = result.signal === "SIGKILL" || (result.error && result.error.code === "ETIMEDOUT");
  const ok = !timedOut && result.status === 0;
  results.push({ script, ok, status: result.status, timedOut });
  if (timedOut) {
    console.log(`\nrun-all: ${script} TIMED OUT after ${PER_SCRIPT_TIMEOUT_MS / 1000}s and was killed`);
    console.log("         A browser-check that hangs is usually a script that threw");
    console.log("         before closing its target server - see the try/finally in");
    console.log("         feed-rerender-storm.mjs for the shape every script needs.");
  } else {
    console.log(ok ? `\nrun-all: ${script} passed` : `\nrun-all: ${script} FAILED (exit ${result.status ?? 1})`);
  }
}

const failedScripts = results.filter((r) => !r.ok);
console.log(`\n${"=".repeat(60)}\nrun-all summary: ${results.length - failedScripts.length}/${results.length} passed\n${"=".repeat(60)}`);
for (const r of results) console.log(`  ${r.ok ? "PASS" : (r.timedOut ? "HUNG" : "FAIL")}  ${r.script}`);

if (failedScripts.length) {
  console.log(`\nrun-all: ${failedScripts.length} scenario(s) failed`);
  process.exit(1);
}
console.log("\nrun-all: everything passed");
