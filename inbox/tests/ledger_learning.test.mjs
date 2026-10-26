// Boundary: /feedback must move the same sample ledger that /run reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
process.env.NO_NETWORK = '1';
process.env.SAMPLE_MODE = 'true';
const { config, INBOX_ROOT } = await import('../src/config.mjs');
const { createServer, runs } = await import('../src/server.mjs');
const decisions = await import('../src/decisions.mjs');
const refund = readFileSync(join(INBOX_ROOT, 'data/synthetic/trust-ledger.csv'), 'utf8').split('\n').find(l => l.startsWith('refund,')).split(',');
const seed = Number(refund[1]), floor = Number(refund[2]);
const expected = Math.ceil(Math.round(((floor - seed) / 0.05) * 1e6) / 1e6);
function post(base, path, body) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => text += c);
      res.on('end', () => { try { assert.equal(res.statusCode, 200, text); resolve(JSON.parse(text)); } catch (e) { reject(e); } });
    }); req.on('error', reject); req.end(JSON.stringify(body));
  });
}
test('(seam) a server on its own folder learns from /feedback', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'jedi-ledger-seam-'));
  runs.clear();
  const dir = join(parent, 'runtime');
  const server = createServer({ cfg: config({ SAMPLE_MODE: 'true' }), deps: { dir, logsDir: join(parent, 'logs'), memoryDir: join(parent, 'memory'), persistRuns: false, quiet: true, publish: async () => ({ published: false }) } });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let result;
    for (let n = 0; n <= expected; n++) {
      result = await post(base, '/run', { run_id: `seam-${n}`, input: { thread_id: 'T02' } });
      if (n < expected) {
        assert.equal(result.output.decision, 'hold');
        assert.equal(result.branch_id, 'under-floor');
        await post(base, '/feedback', { run_id: `seam-${n}`, verdict: 'affirm' });
      }
    }
    assert.equal(result.output.decision, 'send', `still ${result.output.decision} after ${expected} affirms`);
    assert.equal(decisions.readDecisions({ dir }).filter(r => r.verdict === 'affirm').length, expected);
  } finally { await new Promise(resolve => server.close(resolve)); runs.clear(); rmSync(parent, { recursive: true, force: true }); }
});

// Boundary: the proof must exercise real verdict arithmetic without reading shared runtime state.
const { runLedgerLearning, render, maskCommit, sampleServer, httpJson, traceLines } = await import('../scripts/ledger_learning.mjs');
const { spyFs, spyProcs } = await import('./helpers/fs_spy.mjs');
const { existsSync, statSync, readdirSync, writeFileSync } = await import('node:fs');
const { resolve, sep } = await import('node:path');
const shared = [join(decisions.RUNTIME_DIR, 'decisions.csv'), join(decisions.RUNTIME_DIR, 'intake.csv'), join(decisions.RUNTIME_DIR, 'runs'), join(INBOX_ROOT, 'data/memory')];
const snapshot = () => shared.map(p => !existsSync(p) ? null : { mtime: statSync(p).mtimeMs, entries: statSync(p).isDirectory() ? readdirSync(p).sort() : null });

test('(G4) derived threshold, reject, determinism, isolation and committed proof', async () => {
  const before = snapshot();
  const control = mkdtempSync(join(tmpdir(), 'jedi-ledger-control-'));
  writeFileSync(join(control, 'decisions.csv'), decisions.HEADER.join(',') + '\n');
  const fsSpy = spyFs(), procSpy = spyProcs();
  let a, b;
  try {
    decisions.readDecisions({ dir: control });
    assert.ok(fsSpy.paths.includes(join(control, 'decisions.csv')), 'negative control: the spy must see a ledger read');
    a = await runLedgerLearning(); b = await runLedgerLearning();
    const forbidden = fsSpy.paths.filter(p => shared.some(root => resolve(p) === root || resolve(p).startsWith(root + sep)) || resolve(p) === decisions.RUNTIME_DIR || resolve(p).startsWith(decisions.RUNTIME_DIR + sep));
    assert.deepEqual(forbidden, [], 'no real runtime or memory access');
    assert.deepEqual(procSpy.calls, [], 'no child processes');
  } finally { fsSpy.restore(); procSpy.restore(); rmSync(control, { recursive: true, force: true }); }
  assert.deepEqual(snapshot(), before, 'real files and directory entries unchanged');
  const parents = new Set(fsSpy.paths.flatMap(p => p.match(/.*[\\/]jedi-ledger-[^\\/]+/g) || []));
  for (const parent of parents) assert.equal(existsSync(parent), false, 'temporary parent removed');
  assert.equal(a.affirms_to_send, expected);
  assert.equal(a.rows.at(-3).decision, 'hold'); assert.ok(a.rows.at(-3).weight < floor);
  assert.equal(a.rows.at(-2).decision, 'send'); assert.ok(a.rows.at(-2).weight >= floor);
  assert.equal(a.rows.at(-1).decision, 'hold'); assert.equal(a.rows.at(-1).weight, Math.round((floor - 0.05) * 1e6) / 1e6);
  assert.deepEqual(a.rows, b.rows, 'twice in one process');
  assert.equal(render(a), render(b), 'byte-identical markdown');
  assert.equal(maskCommit(render(a)), maskCommit(readFileSync(join(INBOX_ROOT, 'judging/ledger-learning.md'), 'utf8')), 'node scripts/ledger_learning.mjs --write');
});

test('(G4) failing the cap still removes the temporary state', async () => {
  const spy = spyFs();
  try { await assert.rejects(runLedgerLearning({ maxAffirms: 0 }), /never sent after 0 affirms.*last weight/); }
  finally { spy.restore(); }
  for (const p of spy.paths) {
    const parent = p.match(/.*[\\/]jedi-ledger-[^\\/]+/)?.[0];
    if (parent) assert.equal(existsSync(parent), false);
  }
});
