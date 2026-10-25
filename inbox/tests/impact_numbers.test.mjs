// Boundaries: one bucket per real trace, cold ledger isolation, deterministic output and stale judge-facing numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const { computeImpact, renderAll, staleFiles } = await import('../scripts/impact_numbers.mjs');
const { config, INBOX_ROOT } = await import('../src/config.mjs');
const { runTicket } = await import('../src/loop.mjs');
const decisions = await import('../src/decisions.mjs');
const { spyFs, spyProcs } = await import('./helpers/fs_spy.mjs');
let measured;

// Read the files independently before the script removes them, not its already-classified evidence summary.
test('buckets partition 100 traces and obey refusal precedence, including five contract-drift probes', async () => {
  const independent = [];
  measured = await computeImpact({ onTrace({ id, file, result }) {
    const lines = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    const risk = lines.filter(l => l.step === 'risk.signoff' && l.status === 'refused');
    const lastCritic = lines.filter(l => l.step === 'critique').at(-1);
    const branch = lines.find(l => l.step === 'branch' && l.status === 'success')?.branch_id;
    const expected = risk.length ? 'risk_refused' : lastCritic?.status === 'needs_revision' && result.output.decision !== 'send' ? 'critic_refused' : branch === 'under-floor' ? 'under_floor' : 'by_branch';
    independent.push({ id, expected, decision: result.output.decision, branch, lastCritic: lastCritic?.status, risk: risk.length > 0 });
  } });
  const b = measured.buckets;
  const ids = [...Object.values(b.risk_refused).flat(), ...b.critic_refused, ...b.under_floor, ...Object.values(b.by_branch).flat()];
  assert.equal(ids.length, 100); assert.equal(new Set(ids).size, 100);
  for (const x of independent) {
    const actual = measured.runs.find(r => r.id === x.id);
    assert.equal(actual.bucket, x.expected, x.id);
    if (['risk_refused','critic_refused'].includes(actual.bucket)) assert.notEqual(x.decision, 'send', x.id);
    if (x.lastCritic === 'skipped' && !x.risk) assert.ok(!['risk_refused','critic_refused'].includes(actual.bucket), x.id);
    if (actual.bucket === 'under_floor') assert.equal(x.branch, 'under-floor', x.id);
    if (x.risk) assert.equal(actual.bucket, 'risk_refused', x.id);
  }
  assert.equal(b.critic_refused.length, independent.filter(x => x.expected === 'critic_refused').length);
  for (const id of ['T02','T03','T04','T27','T30']) assert.equal(measured.runs.find(r => r.id === id).bucket, independent.find(x => x.id === id).expected, id);
});

test('twice in one process is deterministic, starts cold, never accesses shared state or starts a child, and cleans temp parents', async () => {
  const control = mkdtempSync(join(tmpdir(), 'jedi-impact-control-'));
  writeFileSync(join(control, 'decisions.csv'), decisions.HEADER.join(',') + '\n');
  const fs = spyFs(), procs = spyProcs();
  let first, second;
  try {
    decisions.readDecisions({ dir: control });
    assert.ok(fs.paths.includes(join(control, 'decisions.csv')), 'negative control: the fs spy observes ledger reads');
    first = await computeImpact(); second = await computeImpact();
    assert.deepEqual(procs.calls, []);
    const roots = [decisions.RUNTIME_DIR, join(INBOX_ROOT, 'data/memory')];
    assert.deepEqual(fs.paths.filter(p => roots.some(root => resolve(p) === root || resolve(p).startsWith(root + sep))), []);
  } finally { fs.restore(); procs.restore(); rmSync(control, { recursive: true, force: true }); }
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  for (const p of fs.paths) {
    const parent = p.match(/.*[\\/]jedi-(?:impact|ledger|heldout)-[^\\/]+/)?.[0];
    if (parent) assert.equal(existsSync(parent), false, `left temp parent ${parent}`);
  }
  const parent = mkdtempSync(join(tmpdir(), 'jedi-impact-twin-'));
  try {
    const decisionsDir = join(parent, 'decisions');
    for (let i = 0; i < first.ledger.affirms_to_send; i++) {
      await decisions.appendDecision({ run_id: `affirm-${i}`, category: 'refund', decision: 'hold' }, { dir: decisionsDir });
      await decisions.setVerdict(`affirm-${i}`, 'affirm', undefined, { dir: decisionsDir });
    }
    const r = await runTicket('T02', { run_id: 'cold-twin', cfg: config({ SAMPLE_MODE: 'true' }), deps: { decisionsDir, runtimeDir: join(parent,'runtime'), logsDir: join(parent,'logs'), memoryDir: join(parent,'memory'), quiet: true } });
    assert.equal(first.runs.find(r => r.id === 'T02').branch_id, 'under-floor');
    assert.equal(r.branch_id, 'send-ok'); assert.equal(r.output.decision, 'send');
    assert.deepEqual(await computeImpact(), first, 'a separate prefilled ledger cannot move the grid');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('every committed number is current', async () => {
  assert.deepEqual(await staleFiles({ result: measured }), [], 'node scripts/impact_numbers.mjs --write (from inbox/)');
});

test('optional marker removal, mandatory missing markers, malformed markers and numeric drift are detected correctly', async () => {
  const r = measured ?? await computeImpact();
  const parent = mkdtempSync(join(tmpdir(), 'jedi-impact-docs-')), root = join(parent, 'inbox');
  mkdirSync(root);
  try {
    const seeds = { 'README.md': 'results', '../README.md': 'root', 'judging/heldout/README.md': 'heldout' };
    for (const [file, marker] of Object.entries(seeds)) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), `before\n<!-- impact:${marker}:start -->\nold\n<!-- impact:${marker}:end -->\nafter\n`);
    }
    for (const [file, text] of Object.entries(renderAll(r, { root }))) {
      mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text);
    }
    assert.deepEqual(await staleFiles({ result: r, root }), []);
    for (const file of ['../README.md', 'judging/heldout/README.md']) writeFileSync(join(root,file), 'handwritten without markers\n');
    const notes = [];
    assert.deepEqual(await staleFiles({ result: r, root, notes }), []); assert.equal(notes.length, 2);
    const readme = readFileSync(join(root,'README.md'), 'utf8');
    writeFileSync(join(root,'README.md'), 'no mandatory markers\n');
    assert.ok((await staleFiles({ result: r, root })).includes('README.md'));
    assert.throws(() => renderAll(r, { root }), /README.md.*markers/);
    writeFileSync(join(root,'README.md'), readme + '\n<!-- impact:results:start -->\n');
    assert.ok((await staleFiles({ result: r, root })).includes('README.md'));
    assert.throws(() => renderAll(r, { root }), /doubled/);
    writeFileSync(join(root,'README.md'), readme.replace(`${r.heldout.passed} of ${r.heldout.total} match`, '99 of 20 match'));
    assert.ok((await staleFiles({ result: r, root })).includes('README.md'), 'stale README number must fail');
    writeFileSync(join(root,'README.md'), readme.replace(/commit `[^`]+` \([\d-]+\)/, 'commit `0000000` (2000-01-01)'));
    assert.deepEqual(await staleFiles({ result: r, root }), [], 'only provenance may differ');
    writeFileSync(join(root,'README.md'), readme.replace('No time-saved figure: we measured no human baseline.', 'No time-saved figure: decision code and inputs at commit 999 changed 100 numbers.'));
    assert.ok((await staleFiles({ result: r, root })).includes('README.md'), 'a phrase elsewhere cannot hide a number');
    const jsonPath = join(root, 'judging/impact-numbers.json');
    writeFileSync(jsonPath, readFileSync(jsonPath, 'utf8').replace('"total": 100', '"total": 99'));
    assert.ok((await staleFiles({ result: r, root })).includes('judging/impact-numbers.json'));
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
