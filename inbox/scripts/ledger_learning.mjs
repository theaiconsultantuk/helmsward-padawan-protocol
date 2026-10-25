// Only disposable sample state is accepted here: feedback on the hosted ledger is shared by every judge.
process.env.NO_NETWORK = '1';
process.env.SAMPLE_MODE = 'true';
const { config, INBOX_ROOT, sampleMode } = await import('../src/config.mjs');
const { createServer, runs } = await import('../src/server.mjs');
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { isMain } from '../src/main_guard.mjs';

// Read provenance separately from the computation so isolation tests can forbid all child processes.
export function rulesCommit() {
  try { return execFileSync('git', ['-c', 'safe.directory=*', '-C', INBOX_ROOT, 'log', '-1', '--format=%h %cs', '--', 'src', 'data', 'judging/heldout/heldout-inputs.json', 'judging/heldout/heldout-labels.json', 'public/demo-scenarios.json', 'judging/traces'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim() || 'unknown'; }
  catch { return 'unknown'; }
}
const provenance = rulesCommit();
export const inputCommit = () => provenance;
export const maskCommit = text => text.replace(/^.*decision code and inputs at commit.*$/gm, '<inputs commit>');
export const commitLine = value => {
  const [sha, date] = value.split(' ');
  return `Sample mode, decision code and inputs at commit \`${sha}\`${date ? ` (${date})` : ''}.`;
};
export function httpJson(base, path, body) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => text += c);
      res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = {}; } resolve({ code: res.statusCode, data, text }); });
    });
    req.on('error', reject); req.setTimeout(60000, () => req.destroy(new Error('sample HTTP timeout')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
export async function sampleServer(prefix = 'jedi-ledger-') {
  const parent = mkdtempSync(join(tmpdir(), prefix));
  const dir = join(parent, 'runtime'), logsDir = join(parent, 'logs'), memoryDir = join(parent, 'memory');
  const cfg = config({ SAMPLE_MODE: 'true', NO_NETWORK: '1' });
  if (!sampleMode(cfg) || cfg.SAMPLE_MODE !== 'true') throw new Error('sample mode required');
  runs.clear();
  const server = createServer({ cfg, deps: { dir, logsDir, memoryDir, persistRuns: false, quiet: true, publish: async () => ({ published: false }) } });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (e) { rmSync(parent, { recursive: true, force: true }); runs.clear(); throw e; }
  return { base: `http://127.0.0.1:${server.address().port}`, parent, logsDir, dir,
    async close() { try { await new Promise(resolve => server.close(resolve)); } finally { runs.clear(); rmSync(parent, { recursive: true, force: true }); } } };
}
export function traceLines(logsDir, id) {
  return readFileSync(join(logsDir, `trace-${id}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
}
export async function runLedgerLearning({ maxAffirms = 20 } = {}) {
  const demo = JSON.parse(readFileSync(join(INBOX_ROOT, 'public/demo-scenarios.json'), 'utf8')).find(s => s.id === 's01');
  if (!demo) throw new Error('s01 is missing from public/demo-scenarios.json');
  const server = await sampleServer();
  const rows = [];
  try {
    const run = async action => {
      const n = rows.length + 1, id = `ledger-demo-${n}`;
      const { data: r, code, text } = await httpJson(server.base, '/run', { run_id: id, input: { message: demo.message, from: `${id}@email.com`, name: 'Ledger Demo', channel: demo.channel, scenario: demo.scenario, as_of: demo.as_of } });
      if (code !== 200) throw new Error(`ledger /run HTTP ${code}: ${text}`);
      const lines = traceLines(server.logsDir, id);
      const line = lines.find(l => l.step === 'branch' && l.status === 'success');
      const match = (r.output?.reasons?.[0] || line?.output_summary || '').match(/weight (\d+(?:\.\d+)?) (?:is under|meets) the floor (\d+(?:\.\d+)?)/);
      if (!line || !match) throw new Error(`missing refund weight or floor on ${id}`);
      const intake = lines.filter(l => l.action === 'intake_publish');
      if (!intake.length || intake.some(l => !l.output_summary.startsWith('published: false (sample mode'))) throw new Error('intake was not sample-only');
      rows.push({ step: n, action, run_id: id, trace_id: r.trace_id, weight: Number(match[1]), floor: Number(match[2]), decision: r.output.decision, branch_id: r.branch_id, branch_line: line.output_summary });
      return rows.at(-1);
    };
    const verdict = async (row, value) => {
      const { code, text } = await httpJson(server.base, '/feedback', { run_id: row.run_id, verdict: value });
      if (code !== 200) throw new Error(`ledger /feedback HTTP ${code}: ${text}`);
    };
    let current = await run('No feedback yet'), affirms = 0;
    while (current.decision === 'hold' && current.branch_id === 'under-floor' && affirms < maxAffirms) {
      await verdict(current, 'affirm'); affirms++;
      current = await run(`Affirm run ${affirms}`);
    }
    if (current.decision !== 'send') throw new Error(`the refund never sent after ${maxAffirms} affirms (last weight ${current.weight})`);
    await verdict(current, 'reject');
    const last = await run(`Reject run ${current.step}`);
    if (last.decision !== 'hold' || last.branch_id !== 'under-floor') throw new Error('the reject did not move it back');
    return { seed: rows[0].weight, floor: rows[0].floor, step: 0.05, affirms_to_send: affirms, rows, rules_commit: provenance };
  } finally { await server.close(); }
}
export function render(r) {
  return `---\ntitle: Trust ledger learning\ndescription: Staff feedback changes a refund from hold to send and back in sample mode.\ntags: [judging, trust, feedback]\n---\n\n# Trust ledger learning\n\n${commitLine(r.rules_commit)}\nRegenerate from \`inbox/\`: \`node scripts/impact_numbers.mjs --write\` (or this file alone: \`node scripts/ledger_learning.mjs --write\`).\n\nThe ticket is s01, “${JSON.parse(readFileSync(join(INBOX_ROOT, 'public/demo-scenarios.json'), 'utf8')).find(s => s.id === 's01').message}”\nIt asks for 80 GC within the 150 GC limit, with a fresh customer each run as on the contact page.\n\n| Step | What a person did before it | Run and trace id | Refund weight | Floor | Decision | Branch |\n|---|---|---|---|---|---|---|\n${r.rows.map(x => `| ${x.step} | ${x.action} | ${x.run_id} / ${x.trace_id} | ${x.weight.toFixed(2)} | ${x.floor.toFixed(2)} | ${x.decision} | ${x.branch_id} |`).join('\n')}\n\nThe seed is ${r.seed.toFixed(2)} from \`data/synthetic/trust-ledger.csv\`; \`src/gates.mjs\` (\`trustFloor\`) computes seed + ${r.step.toFixed(2)} × affirms − ${r.step.toFixed(2)} × rejects, with the deltas in \`src/decisions.mjs\` (\`VERDICTS\`).\n${r.affirms_to_send} affirms move the weight to ${r.rows.at(-2).weight.toFixed(2)} and the refund sends; one reject moves it to ${r.rows.at(-1).weight.toFixed(2)} and the next refund holds.\n\nThe branch trace lines, verbatim:\n\n${r.rows.map(x => `- ${x.run_id}: ${x.branch_line}`).join('\n')}\n\nWhat a live server adds: the counts come from \`JEDI_PACK.decisions\` in Zetaris (\`queries.mjs\` \`ledger_adjust\`) instead of the local file; the arithmetic is the same.\nHow to film it: use a local sample-mode server and the contact page's s01 scenario, affirm each held run, then reject the send.\nThe hosted ledger is shared by every judge.\n`;
}
if (isMain(import.meta.url)) {
  try {
    const text = render(await runLedgerLearning()), file = join(INBOX_ROOT, 'judging/ledger-learning.md');
    if (process.argv.includes('--write')) { mkdirSync(join(INBOX_ROOT, 'judging'), { recursive: true }); writeFileSync(file, text); }
    else if (process.argv.includes('--check')) { if (maskCommit(readFileSync(file, 'utf8')) !== maskCommit(text)) { console.error('ledger-learning.md is stale: node scripts/ledger_learning.mjs --write'); process.exitCode = 1; } }
    else process.stdout.write(text);
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
