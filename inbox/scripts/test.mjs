// npm test: run `node --test` on tests/*.test.mjs with ONE private temp folder, removed afterwards.
// The tests mkdtemp many folders under os.tmpdir() and never delete them; pointing TMPDIR/TEMP/TMP at a single run folder
// and removing it (finally + signals) keeps the machine's temp space clean. `node --test tests/x.test.mjs` still works directly.
// Extra argv is passed through: `npm test -- tests/queries.test.mjs` runs just that file; with no file argument, every tests/*.test.mjs runs.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, constants as osConstants } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const inbox = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(inbox, "tests");
const runDir = mkdtempSync(join(tmpdir(), "jedi-test-"));

// The run folder counts as cleaned only once it is really gone; a failed removal is reported (with the path) and fails an otherwise green run.
let removed = false;
let removeError = null;
function cleanup() {
  if (removed) return true;
  try {
    rmSync(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    removed = true;
    removeError = null;
  } catch (e) {
    removeError = e;
  }
  return removed;
}
let reported = false;
function reportLeft() {
  if (reported || removed) return;
  reported = true;
  console.error(`test wrapper: could not remove the run folder ${runDir}: ${removeError && removeError.message}`);
}

const args = process.argv.slice(2);
const files = args.some((a) => !a.startsWith("-"))
  ? []
  : readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join("tests", f));

// NODE_TEST_CONTEXT is how a running test marks its children; left set, a nested `node --test` would report to it and exit 0.
const env = { ...process.env, TMPDIR: runDir, TEMP: runDir, TMP: runDir };
delete env.NODE_TEST_CONTEXT;
const child = spawn(process.execPath, ["--test", ...args, ...files], { cwd: inbox, stdio: "inherit", env });

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const forwarders = {};
for (const sig of SIGNALS) {
  forwarders[sig] = () => { try { child.kill(sig); } catch { /* already gone */ } };
  process.on(sig, forwarders[sig]);
}
child.on("error", (e) => { console.error(`test wrapper: ${e.message}`); cleanup(); reportLeft(); process.exit(1); });
child.on("close", (code, signal) => {
  const ok = cleanup();
  if (!ok) reportLeft();
  if (signal) {
    // keep the child's termination signal: drop the forwarders and re-raise it on ourselves; where that cannot end us (Windows), exit 128+signo
    for (const sig of SIGNALS) process.removeListener(sig, forwarders[sig]);
    const no = osConstants.signals[signal] ?? 0;
    try { process.kill(process.pid, signal); } catch { /* fall through */ }
    setTimeout(() => process.exit(128 + no), 200);
    return;
  }
  process.exit(code !== 0 ? (code ?? 1) : (ok ? 0 : 1));
});
// last chance: retry the removal; if it still fails, an otherwise passing run fails
process.on("exit", () => {
  if (!cleanup()) { reportLeft(); if (!process.exitCode) process.exitCode = 1; }
});
