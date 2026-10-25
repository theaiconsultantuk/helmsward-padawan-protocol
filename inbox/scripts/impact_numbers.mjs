// One computation supplies the report, README blocks and stale-number guard.
process.env.NO_NETWORK = '1';
process.env.SAMPLE_MODE = 'true';
const { config, INBOX_ROOT } = await import('../src/config.mjs');
const { runTicket } = await import('../src/loop.mjs');
const { runHeldout } = await import('./heldout_run.mjs');
const { runLedgerLearning, render: renderLedger, inputCommit, commitLine, maskCommit, traceLines } = await import('./ledger_learning.mjs');
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMain } from '../src/main_guard.mjs';

// Resolve the committed input list once, before the isolated computation; archives use their bundled traces.
const liveFiles = (() => {
  try { return execFileSync('git', ['-c', 'safe.directory=*', '-C', INBOX_ROOT, 'ls-files', '--', 'judging/traces/*live*.jsonl'], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim().split('\n').filter(Boolean).sort(); }
  catch { return readdirSync(join(INBOX_ROOT, 'judging/traces')).filter(f => /live.*\.jsonl$/.test(f)).sort().map(f => `judging/traces/${f}`); }
})();
const reasonNames = {
  over_limit: 'Over-limit refunds: the agent may not promise them, routed to the approver (escalate)',
  restricted_fact: 'Restricted facts: no draft written, escalated to the owner',
  earlier_promise: 'The earlier reply promised something not asked for: no autonomous reply',
  other_risk: 'Other Risk refusals (trace text below)',
};
const countRisk = r => Object.values(r.buckets.risk_refused).reduce((n, ids) => n + ids.length, 0);
const stopped = r => countRisk(r) + r.buckets.critic_refused.length;
const stoppedLabel = r => r.buckets.critic_refused.length ? 'Replies stopped from auto-sending' : 'Replies Risk stopped from auto-sending';
const cell = s => String(s ?? '').replace(/\|/g, '&#124;').replace(/\n/g, ' ');
const table = (head, rows) => `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.map(cell).join(' | ')} |`).join('\n')}`;
export function classify(result, lines) {
  const risk = lines.find(l => l.step === 'risk.signoff' && l.status === 'refused');
  if (risk) {
    const s = risk.output_summary;
    const reason = /over the .* limit/i.test(s) ? 'over_limit' : /fact may not leave/i.test(s) ? 'restricted_fact' : /earlier reply promised|earlier promise/i.test(s) ? 'earlier_promise' : 'other_risk';
    return { bucket: 'risk_refused', reason };
  }
  if (lines.filter(l => l.step === 'critique').at(-1)?.status === 'needs_revision' && result.output.decision !== 'send') return { bucket: 'critic_refused' };
  if (result.branch_id === 'under-floor') return { bucket: 'under_floor' };
  return { bucket: 'by_branch', key: `${result.output.decision}|${result.branch_id ?? 'none'}` };
}
export async function computeImpact({ onTrace } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'jedi-impact-'));
  try {
    const threads = readFileSync(join(INBOX_ROOT, 'data/synthetic/threads/threads.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    if (threads.length !== 100) throw new Error(`expected 100 threads, got ${threads.length}`);
    const buckets = { risk_refused: { over_limit: [], restricted_fact: [], earlier_promise: [], other_risk: [] }, critic_refused: [], under_floor: [], by_branch: {} }, runs = [];
    for (const t of threads) {
      const id = t.thread_id, run_id = `impact-${id}`;
      const dirs = Object.fromEntries(['logsDir','memoryDir','decisionsDir','runtimeDir'].map(k => [k, join(parent, id, k)]));
      const r = await runTicket(id, { run_id, cfg: config({ SAMPLE_MODE: 'true' }), deps: { ...dirs, quiet: true } });
      const lines = traceLines(dirs.logsDir, run_id), c = classify(r, lines);
      onTrace?.({ id, file: join(dirs.logsDir, `trace-${run_id}.jsonl`), result: r });
      if (c.bucket === 'risk_refused') buckets.risk_refused[c.reason].push(id);
      else if (c.bucket === 'by_branch') (buckets.by_branch[c.key] ??= []).push(id);
      else buckets[c.bucket].push(id);
      runs.push({ id, category: t.category, decision: r.output.decision, branch_id: r.branch_id, ...c,
        trace: lines.filter(l => ['risk.signoff','critique','branch'].includes(l.step)).map(l => ({ step: l.step, status: l.status, output_summary: l.output_summary, ...(l.branch_id ? { branch_id: l.branch_id } : {}) })) });
    }
    const heldout = await runHeldout();
    const { rules_commit: _ledgerCommit, ...ledger } = await runLedgerLearning();
    const timing = liveFiles.map(file => {
      const lines = readFileSync(join(INBOX_ROOT, file), 'utf8').trim().split('\n').map(JSON.parse);
      const seconds = (Date.parse(lines.at(-1)?.timestamp) - Date.parse(lines[0]?.timestamp)) / 1000;
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`invalid timing in ${file}`);
      return { file, seconds, calls_model: lines.some(l => l.step === 'nvidia.model' && l.status === 'success') };
    });
    const spans = timing.filter(t => t.calls_model).map(t => t.seconds).sort((a,b) => a-b);
    const fixed = timing.filter(t => !t.calls_model), n = spans.length;
    const live = { traces: timing, model: { n, min: n ? spans[0] : null, median: n ? Math.round((spans[Math.floor((n-1)/2)] + spans[Math.floor(n/2)]) / 2) : null, max: n ? spans.at(-1) : null }, fixed: { n: fixed.length, max: fixed.length ? Math.max(...fixed.map(t => t.seconds)) : null } };
    return { rules_commit: inputCommit(), total: threads.length, buckets, runs, heldout, ledger, live };
  } finally { rmSync(parent, { recursive: true, force: true }); }
}
const fixedText = r => r.live.fixed.n ? `fixed decisions within ${Math.max(1, Math.ceil(r.live.fixed.max))} s` : 'no fixed-decision timing available';
const timeText = r => r.live.model.n ? `median ${r.live.model.median} s over ${r.live.model.n} live runs that call the model (${r.live.model.min}-${r.live.model.max} s); ${fixedText(r)}` : `no model-calling live traces; ${fixedText(r)}`;
function bucketRows(r) {
  return [
    ...Object.entries(r.buckets.risk_refused).filter(([,ids]) => ids.length).map(([k,ids]) => [reasonNames[k], ids.length, ids.join(', ')]),
    ...(r.buckets.critic_refused.length ? [['Stopped by the critic', r.buckets.critic_refused.length, r.buckets.critic_refused.join(', ')]] : []),
    ['Held until trusted', r.buckets.under_floor.length, r.buckets.under_floor.join(', ')],
    ...Object.entries(r.buckets.by_branch).map(([k,ids]) => [k.replace('|', ' / '), ids.length, ids.join(', ')]),
    ['Total', Object.values(r.buckets.risk_refused).flat().length + r.buckets.critic_refused.length + r.buckets.under_floor.length + Object.values(r.buckets.by_branch).flat().length, 'Each thread counted once'],
  ];
}
function resultBlock(r) {
  const rows = [
    ['Held-out set (never tuned on)', `${r.heldout.passed} of ${r.heldout.total} match`, '[Held-out proof](judging/heldout/README.md)'],
    [stoppedLabel(r), `${stopped(r)} of ${r.total}`, '[Impact numbers](judging/impact-numbers.md)'],
    ...Object.entries(r.buckets.risk_refused).filter(([,ids]) => ids.length).map(([k,ids]) => [`↳ ${reasonNames[k]}`, ids.length, '']),
    ...(r.buckets.critic_refused.length ? [['↳ Stopped by the critic', r.buckets.critic_refused.length, '']] : []),
    ['Held until trusted', `${r.buckets.under_floor.length} of ${r.total}`, '[Impact numbers](judging/impact-numbers.md)'],
    ['Ledger learns', `${r.ledger.affirms_to_send} affirms: hold to send; 1 reject: back to hold`, '[Ledger learning](judging/ledger-learning.md)'],
    ['Live decision time', timeText(r), '[Committed live traces](judging/traces/)'],
  ];
  return `## Results\n\n${commitLine(r.rules_commit)}\n\n${table(['What','Number','Proof'], rows)}\n\nNo time-saved figure: we measured no human baseline.\nRegenerate: \`node scripts/impact_numbers.mjs --write\` (from \`inbox/\`).`;
}
function heldoutBlock(r) {
  const rows = r.heldout.rows, misses = rows.filter(x => !x.pass);
  const held = misses.filter(x => x.got === 'hold' && x.want.some(w => ['send','escalate'].includes(w)));
  const sent = misses.filter(x => x.got === 'send' && x.want.some(w => ['hold','close'].includes(w)));
  return `${commitLine(r.rules_commit)}\n${r.heldout.passed} of ${r.heldout.total} match the label.\n\n${table(['Result','Count'], [
    ['Matched the label', r.heldout.passed], ['Held where the label wanted escalate or send', held.length], ['Sent where the label wanted hold or close', sent.length], ['Any other miss', misses.length - held.length - sent.length], ['Promised a refund amount', rows.filter(x => x.promise != null).length],
  ])}\n\n${misses.map(x => `- ${x.id} ${x.tag}: got ${x.got}, want ${x.want.join('/')} (${x.branch ?? 'none'}): ${x.why}`).join('\n')}\n\nEvery line: [results-sample-mode.txt](results-sample-mode.txt).`;
}
function blockSpecs(r) {
  const reasons = Object.entries(r.buckets.risk_refused).filter(([,v]) => v.length).map(([k,v]) => `${v.length} ${reasonNames[k].toLowerCase()}`).join('; ');
  return [
    { file: 'README.md', marker: 'results', optional: false, text: resultBlock(r) },
    { file: '../README.md', marker: 'root', optional: true, text: `${commitLine(r.rules_commit)}\nOn ${r.heldout.total} messages the rules were never tuned on (8 adversarial), sample mode matches the expected decision on **${r.heldout.passed}**.\nAcross the ${r.total} threads, ${r.buckets.critic_refused.length ? 'Risk and the critic' : 'Risk'} stopped ${stopped(r)} replies from auto-sending (${reasons}${r.buckets.critic_refused.length ? `; ${r.buckets.critic_refused.length} stopped by the critic` : ''}) and ${r.buckets.under_floor.length} waited for a person until their category is trusted.\n[Held-out evidence](inbox/judging/heldout/README.md) · [Results and regeneration](inbox/README.md#results).` },
    { file: 'judging/heldout/README.md', marker: 'heldout', optional: true, text: heldoutBlock(r) },
  ];
}
function artifacts(r) {
  const byCategory = {};
  for (const run of r.runs.filter(x => x.bucket === 'under_floor')) (byCategory[run.category] ??= []).push(run.id);
  const riskRows = Object.entries(r.buckets.risk_refused).filter(([,ids]) => ids.length).map(([k,ids]) => [reasonNames[k], ids.length, ids.join(', ')]);
  const otherRisk = r.runs.filter(x => x.reason === 'other_risk').map(x => `- ${x.id}: ${x.trace.find(l => l.step === 'risk.signoff' && l.status === 'refused').output_summary}`).join('\n');
  const otherRows = Object.entries(r.buckets.by_branch).map(([key,ids]) => [...key.split('|'), ids.length, ids.join(', ')]);
  const md = `---\ntitle: Impact numbers\ndescription: Regenerable sample-mode outcomes, feedback learning and committed live decision timing.\ntags: [judging, impact, evaluation]\n---\n\n# Impact numbers\n\n${commitLine(r.rules_commit)}\nRegenerate from \`inbox/\`: \`node scripts/impact_numbers.mjs --write\`.\n\nSample mode means: Zetaris answered from cached rows, gates, drafter and critic are code rules, no model call.\nA live run adds Nemotron's own drafts and critiques (they can refuse more), OpenJev's typed gates and severity, and the refund Reader; it cannot remove a Risk refusal, which is code.\n\n${r.heldout.passed} of ${r.heldout.total} held-out messages match the label (never tuned on).\n${stoppedLabel(r)}: ${stopped(r)} of ${r.total}.\nHeld until trusted: ${r.buckets.under_floor.length} of ${r.total}.\nLedger learning: ${r.ledger.affirms_to_send} affirms move hold to send, one reject moves it back ([proof](ledger-learning.md)).\n\n## ${stoppedLabel(r)}\n\nA Risk refusal takes precedence, then a critic refusal on a run that did not send, then a trust-floor hold, then every other decision and branch.\nA skipped critic is never counted as a refusal.\n${table(['What happened','Count','Thread ids'], [...riskRows, ...(r.buckets.critic_refused.length ? [['Stopped by the critic', r.buckets.critic_refused.length, r.buckets.critic_refused.join(', ')]] : [])])}\n${otherRisk ? `\n${otherRisk}\n` : ''}\n## Held until trusted, by category\n\n${table(['Category','Count','Thread ids'], Object.entries(byCategory).map(([k,ids]) => [k,ids.length,ids.join(', ')]))}\n\n## Every other decision and branch\n\n${table(['Decision','Branch','Count','Thread ids'], otherRows)}\n\n## All buckets (one per thread)\n\n${table(['Outcome','Count','Thread ids'], bucketRows(r))}\n\n## Held-out set\n\nThese ${r.heldout.total} messages were never tuning inputs; the regression floor reports this result as it is.\n[Inputs, labels and misses](heldout/README.md).\n\n\`\`\`text\n${r.heldout.lines.join('\n')}\n\`\`\`\n\n## Live decision time\n\n${timeText(r)}.\nThe span is the last minus first committed trace timestamp; these timestamps have whole-second resolution.\n${table(['Committed trace','Calls the model','Decision span (s)'], r.live.traces.map(t => [`[${t.file.split('/').at(-1)}](${t.file.replace('judging/','')})`, t.calls_model ? 'yes' : 'no', t.seconds]))}\n\nNo time-saved figure: we measured no human baseline.\n`;
  return { 'judging/impact-numbers.json': JSON.stringify(r, null, 2) + '\n', 'judging/impact-numbers.md': md, 'judging/ledger-learning.md': renderLedger({ ...r.ledger, rules_commit: r.rules_commit }), 'judging/heldout/results-sample-mode.txt': r.heldout.lines.join('\n') + '\n' };
}
function markers(doc, spec) {
  const start = `<!-- impact:${spec.marker}:start -->`, end = `<!-- impact:${spec.marker}:end -->`;
  const n = s => doc.split(s).length - 1;
  if (!n(start) && !n(end) && spec.optional) return null;
  if (n(start) !== 1 || n(end) !== 1 || doc.indexOf(end) < doc.indexOf(start)) throw new Error(`${spec.file}: missing, doubled or reversed impact:${spec.marker} markers`);
  return { start, end, from: doc.indexOf(start) + start.length, to: doc.indexOf(end) };
}
export function renderAll(result, { root = INBOX_ROOT, notes = [] } = {}) {
  const files = artifacts(result);
  for (const spec of blockSpecs(result)) {
    const doc = readFileSync(join(root, spec.file), 'utf8'), m = markers(doc, spec);
    if (!m) { notes.push(`${spec.file}: no impact:${spec.marker} markers; left alone`); continue; }
    files[spec.file] = doc.slice(0, m.from) + '\n' + spec.text + '\n' + doc.slice(m.to);
  }
  return files;
}
const normalized = text => maskCommit(text).replace(/^  "rules_commit": "[^"\n]*",?$/gm, '  "rules_commit": "<inputs commit>",');
export async function staleFiles({ result, root = INBOX_ROOT, notes = [] } = {}) {
  result ??= await computeImpact();
  const stale = [];
  for (const [file, expected] of Object.entries(artifacts(result))) {
    try { if (normalized(readFileSync(join(root, file), 'utf8')) !== normalized(expected)) stale.push(file); }
    catch { stale.push(file); }
  }
  for (const spec of blockSpecs(result)) {
    try {
      const doc = readFileSync(join(root, spec.file), 'utf8'), m = markers(doc, spec);
      if (!m) { notes.push(`${spec.file}: no impact:${spec.marker} markers; left alone`); continue; }
      if (normalized(doc.slice(m.from, m.to)) !== normalized('\n' + spec.text + '\n')) stale.push(spec.file);
    } catch { stale.push(spec.file); }
  }
  return stale;
}
if (isMain(import.meta.url)) {
  try {
    const result = await computeImpact(), notes = [];
    if (process.argv.includes('--write')) {
      const files = renderAll(result, { notes });
      for (const [file, text] of Object.entries(files)) writeFileSync(join(INBOX_ROOT, file), text);
    } else if (process.argv.includes('--check')) {
      const stale = await staleFiles({ result, notes });
      for (const file of stale) console.error(`${file} is stale: node scripts/impact_numbers.mjs --write (from inbox/)`);
      if (stale.length) process.exitCode = 1;
    } else {
      console.log(`Sample mode: ${result.heldout.passed} of ${result.heldout.total} held-out match; ${stoppedLabel(result)}: ${stopped(result)} of ${result.total}; held until trusted: ${result.buckets.under_floor.length} of ${result.total}.`);
      console.log(table(['Outcome','Count','Thread ids'], bucketRows(result)));
    }
    for (const note of notes) console.error(note);
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
