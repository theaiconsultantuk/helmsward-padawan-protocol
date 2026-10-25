// npm test: run `node --test` on tests/*.test.mjs with ONE private temp folder, removed afterwards.
// The tests mkdtemp many folders under os.tmpdir() and never delete them; pointing TMPDIR/TEMP/TMP at a single run folder
// and removing it (finally + signals) keeps the machine's temp space clean. `node --test tests/x.test.mjs` still works directly.
// Extra argv is passed through: `npm test -- tests/queries.test.mjs` runs just that file; with no file argument, every tests/*.test.mjs runs.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const inbox = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(inbox, "tests");
const runDir = mkdtempSync(join(tmpdir(), "jedi-test-"));

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { rmSync(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
}

const args = process.argv.slice(2);
const files = args.some((a) => !a.startsWith("-"))
  ? []
  : readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join("tests", f));

// NODE_TEST_CONTEXT is how a running test marks its children; left set, a nested `node --test` would report to it and exit 0.
const env = { ...process.env, TMPDIR: runDir, TEMP: runDir, TMP: runDir };
delete env.NODE_TEST_CONTEXT;
const child = spawn(process.execPath, ["--test", ...args, ...files], { cwd: inbox, stdio: "inherit", env });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
}
child.on("error", (e) => { console.error(`test wrapper: ${e.message}`); cleanup(); process.exit(1); });
child.on("close", (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 1));
});
process.on("exit", cleanup);
