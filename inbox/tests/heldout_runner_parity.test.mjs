// Boundary: the node reporter must preserve the independent Python runner's HTTP and text contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { join } from 'node:path';
const { startSampleServer, runHeldout } = await import('../scripts/heldout_run.mjs');
const { INBOX_ROOT } = await import('../src/config.mjs');
const exec = promisify(execFile);
async function python(t) {
  for (const cmd of [...new Set([process.env.PYTHON, 'python3', ...(process.platform === 'win32' ? ['python'] : [])].filter(Boolean))]) {
    try { const r = await exec(cmd, ['--version']); if (/Python 3\./.test(r.stdout + r.stderr)) return cmd; } catch { /* try the next installed name */ }
  }
  t.skip('python not found: the parity check needs python 3');
}
const pyRun = async (cmd, base) => (await exec(cmd, [join(INBOX_ROOT, 'judging/heldout/run_heldout.py'), base, 'parity-py'])).stdout;
test('held-out node and Python runners agree byte for byte on separate fresh sample servers', async t => {
  const cmd = await python(t); if (!cmd) return;
  const a = await startSampleServer();
  let b;
  try {
    const expected = await pyRun(cmd, a.base);
    b = await startSampleServer();
    const actual = await runHeldout({ base: b.base, prefix: 'parity-js' });
    assert.equal(actual.lines.join('\n') + '\n', expected);
    assert.equal(actual.passed, 14, 'base measurement, never a tuning target');
  } finally { await a.close(); if (b) await b.close(); }
});
test('parity includes JSON HTTP errors, non-JSON errors, None, falsy defaults and Unicode truncation', async t => {
  const cmd = await python(t); if (!cmd) return;
  const server = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const id = JSON.parse(body).run_id.split('-').at(-1);
      if (id === 'h02') { res.writeHead(502); res.end('not JSON'); return; }
      res.writeHead(id === 'h01' ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(id === 'h01' ? { status: 'error' } : { output: { decision: '', draft: { promises: { refund_amount: 0 } }, reasons: ['😀'.repeat(109) + 'é🪐tail'] }, branch_id: null }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { assert.equal((await runHeldout({ base })).lines.join('\n') + '\n', await pyRun(cmd, base)); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
