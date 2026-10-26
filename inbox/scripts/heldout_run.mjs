// Node twin of judging/heldout/run_heldout.py; labels are reporting and regression evidence, never tuning inputs.
process.env.NO_NETWORK = '1';
process.env.SAMPLE_MODE = 'true';
const { INBOX_ROOT } = await import('../src/config.mjs');
const { runs } = await import('../src/server.mjs');
const { sampleServer, httpJson } = await import('./ledger_learning.mjs');
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../src/main_guard.mjs';
export async function startSampleServer() { return sampleServer('jedi-heldout-'); }
const pad = (value, n) => { const s = String(value); return s + ' '.repeat(Math.max(0, n - Array.from(s).length)); };
const py = value => value == null ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value);
export function formatRow(r) {
  return `${r.id} ${pad(r.tag, 24)} got=${pad(r.got, 9)} want=${pad(r.want.join('/'), 15)} ${r.pass ? 'PASS' : 'FAIL'} http=${r.http} promise=${py(r.promise)} branch=${py(r.branch)} | ${r.why}`;
}
export async function runHeldout({ base, prefix = 'heldout' } = {}) {
  const server = base ? null : await startSampleServer();
  try {
    base ||= server.base;
    const here = join(INBOX_ROOT, 'judging/heldout');
    const inputs = JSON.parse(readFileSync(join(here, 'heldout-inputs.json'), 'utf8'));
    const labels = new Map(JSON.parse(readFileSync(join(here, 'heldout-labels.json'), 'utf8')).map(l => [l.id, l]));
    const rows = [];
    for (const c of inputs) {
      const { code, data: r } = await httpJson(base.replace(/\/+$/, ''), '/run', { run_id: `${prefix}-${c.id.toLowerCase()}`, input: c.input, options: { sample_mode: true } });
      const out = r.output || {}, draft = out.draft || {};
      const got = out.decision || (r.status === 'error' ? 'error' : 'none');
      const label = labels.get(c.id);
      rows.push({ id: c.id, tag: label.tag, got, want: label.expected_any_of, pass: label.expected_any_of.includes(got), http: code, promise: (draft.promises || {}).refund_amount ?? null, branch: r.branch_id ?? null, why: Array.from((out.reasons || [''])[0]).slice(0, 110).join('') });
    }
    const passed = rows.filter(r => r.pass).length;
    return { rows, passed, total: rows.length, lines: [...rows.map(formatRow), `pass ${passed} / ${rows.length}`] };
  } finally { if (server) { await server.close(); runs.clear(); } }
}
if (isMain(import.meta.url)) {
  try {
    const r = await runHeldout();
    const text = r.lines.join('\n') + '\n';
    if (process.argv.includes('--write')) writeFileSync(join(INBOX_ROOT, 'judging/heldout/results-sample-mode.txt'), text);
    else process.stdout.write(text);
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
