// Track named ESM imports as well as the default builtins; silence is useful only after a positive control.
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
function wrap(target, names, calls, paths = false) {
  const originals = new Map();
  for (const name of names) {
    const original = target[name]; originals.set(name, original);
    target[name] = function (...args) {
      calls.push(String(args[0]));
      if (paths && /rename|copyFile/.test(name)) calls.push(String(args[1]));
      return original.apply(this, args);
    };
  }
  return () => { for (const [name, fn] of originals) target[name] = fn; };
}
export function spyFs() {
  const paths = [];
  const restoreSync = wrap(fs, ['readFileSync','writeFileSync','renameSync','existsSync','mkdirSync','openSync','appendFileSync','statSync','lstatSync','readdirSync','unlinkSync','rmSync','copyFileSync'], paths, true);
  const restoreAsync = wrap(fs.promises, ['readFile','writeFile','rename','rm','mkdir','readdir'], paths, true);
  syncBuiltinESMExports();
  return { paths, restore() { restoreSync(); restoreAsync(); syncBuiltinESMExports(); } };
}
export function spyProcs() {
  const calls = [];
  const restore = wrap(cp, ['spawn','spawnSync','exec','execSync','execFile','execFileSync'], calls);
  syncBuiltinESMExports();
  return { calls, restore() { restore(); syncBuiltinESMExports(); } };
}
