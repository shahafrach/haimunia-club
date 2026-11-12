// waitFor() itself, because 1,982 call sites across 103 files rest on it and
// nothing tested it.
//
// It is the suite's only wall-clock mechanism, which makes it the suite's only
// source of load-induced red. Six tests failed that way on 2026-09-23 - five
// files, none of which the branch under test had touched, all passing in
// isolation minutes later. A flake costs more than a failure: it teaches
// whoever sees red to shrug, and the next real regression gets shrugged at too.
//
// What is pinned here is the behaviour that makes red trustworthy again: a
// late poll cannot lose a true condition, the deadline can be scaled without
// editing 1,982 numbers, and a timeout says which kind of red it is.
import { test } from "node:test";
import assert from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { waitFor } from "./helpers/boot.mjs";

const run = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("a condition already true resolves without waiting", async () => {
  const t0 = Date.now();
  assert.equal(await waitFor(() => "ready"), "ready");
  assert.ok(Date.now() - t0 < 100, "it must not sleep a polling interval first");
});

test("it resolves with the condition's own value, not just true", async () => {
  // Call sites do `const el = await waitFor(() => document.getElementById(...))`
  // and use the result. Returning a boolean would break every one of them.
  const sentinel = { id: "panelUnlock" };
  assert.strictEqual(await waitFor(() => sentinel), sentinel);
});

test("a condition that becomes true before the deadline resolves", async () => {
  let flag = false;
  setTimeout(() => { flag = true; }, 40);
  assert.equal(await waitFor(() => flag, 2000), true);
});

test("THE ORDERING THAT MAKES A LATE POLL SAFE: check() runs before the deadline", async () => {
  // This is the property that means a starved event loop cannot lose a result,
  // and it is why no post-deadline recheck is needed. A recheck was written
  // here first; a negative test showed removing it changed nothing, because
  // the loop already looks at the predicate before it looks at the clock.
  //
  // Pinned with an interval far longer than the budget, so the SECOND poll
  // necessarily happens long after the deadline has passed. A loop that tested
  // the clock first would reject; this one must resolve.
  let flag = false;
  setTimeout(() => { flag = true; }, 30);
  const start = Date.now();
  const result = await waitFor(() => flag, 50, 200);
  assert.equal(result, true, "a poll arriving after the deadline still resolves a true condition");
  assert.ok(Date.now() - start >= 200, "and this really did poll after the deadline, not before it");
});

test("a condition that never comes true still rejects", async () => {
  // The counterweight to the ordering test above: looking at the predicate
  // before the clock must not turn the helper into one that never fails, or
  // every genuine hang becomes a silent pass.
  await assert.rejects(() => waitFor(() => false, 60, 5), /waitFor timed out/);
});

test("a predicate that throws rejects with ITS error, not a timeout", async () => {
  await assert.rejects(
    () => waitFor(() => { throw new Error("selector is wrong"); }, 2000),
    /selector is wrong/,
    "swallowing it into a timeout would hide a broken test as a slow one");
});

test("the timeout message says which kind of red this is", async () => {
  // The deadline printed is the SCALED one, so this expectation has to scale
  // too. It did not, in the first version of this file, and the suite run that
  // caught it was itself run under HAIMUNIA_TEST_TIMEOUT_SCALE=6 to survive a
  // loaded machine - a test about the load knob that could not be run with the
  // load knob on. Derived, not hardcoded.
  const scale = Number(process.env.HAIMUNIA_TEST_TIMEOUT_SCALE) > 0
    ? Number(process.env.HAIMUNIA_TEST_TIMEOUT_SCALE) : 1;
  const err = await waitFor(() => false, 60, 5, "the panel to open").catch((e) => e);
  const m = err.message;
  assert.match(m, /waiting for the panel to open/, "the label names what was awaited");
  assert.match(m, /after \d+ms/, "elapsed time");
  assert.match(m, new RegExp(`deadline ${60 * scale}ms`), "the budget it was held to");
  assert.match(m, /polled \d+\/\d+ times/, "the starvation signature");
  assert.match(m, /loadavg [\d.]+/, "what the machine was doing");
  assert.match(m, /load sensitive/i, "and it says so in words");
  assert.match(m, /HAIMUNIA_TEST_TIMEOUT_SCALE/, "and what to do about it");
});

test("the label is optional, so 1,982 existing call sites keep working", async () => {
  const err = await waitFor(() => false, 60, 5).catch((e) => e);
  assert.match(err.message, /^waitFor timed out after/,
    "no label means no dangling 'waiting for' fragment");
});

// ---------------------------------------------------------------------------
// The scale factor is read from the environment at module load, so it cannot be
// exercised in-process. A child process is the honest test of it.
// ---------------------------------------------------------------------------
const probe = (body) => `
  import { waitFor } from ${JSON.stringify(path.join(root, "test/helpers/boot.mjs"))};
  ${body}
`;

async function runProbe(body, env) {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", probe(body)],
    { cwd: root, env: { ...process.env, ...env } });
  return stdout.trim();
}

test("HAIMUNIA_TEST_TIMEOUT_SCALE multiplies every deadline", async () => {
  const body = `
    const t0 = Date.now();
    await waitFor(() => false, 100, 5).catch(() => {});
    console.log(Date.now() - t0);
  `;
  const plain = Number(await runProbe(body, { HAIMUNIA_TEST_TIMEOUT_SCALE: "" }));
  const scaled = Number(await runProbe(body, { HAIMUNIA_TEST_TIMEOUT_SCALE: "6" }));
  assert.ok(plain >= 100 && plain < 400, `unscaled ran ${plain}ms, expected about 100`);
  assert.ok(scaled > plain * 2,
    `x6 must visibly lengthen the budget (unscaled ${plain}ms, scaled ${scaled}ms)`);
});

test("the scaled deadline is named in the message, so nobody misreads the number", async () => {
  const body = `
    const e = await waitFor(() => false, 100, 5).catch((x) => x);
    console.log(e.message);
  `;
  assert.match(await runProbe(body, { HAIMUNIA_TEST_TIMEOUT_SCALE: "3" }), /deadline 300ms, scaled x3/);
});

test("a nonsense scale is ignored rather than zeroing every deadline", async () => {
  // SCALE=0 or SCALE=-1 would make every deadline expire instantly and turn the
  // whole suite red; a typo in an env var must not be able to do that.
  const body = `
    const t0 = Date.now();
    await waitFor(() => false, 100, 5).catch(() => {});
    console.log(Date.now() - t0);
  `;
  for (const bad of ["0", "-1", "banana", ""]) {
    const ms = Number(await runProbe(body, { HAIMUNIA_TEST_TIMEOUT_SCALE: bad }));
    assert.ok(ms >= 100, `SCALE=${JSON.stringify(bad)} collapsed the deadline to ${ms}ms`);
  }
});
