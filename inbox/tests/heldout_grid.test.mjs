// Regression floor for the sealed set; decision rules must never be tuned on these labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runHeldout } from '../scripts/heldout_run.mjs';
const PIN = JSON.parse(readFileSync(new URL('./fixtures/heldout_pin.json', import.meta.url), 'utf8'));
test('held-out grid: sample mode passes at least the pinned count', async () => {
  const result = await runHeldout();
  console.log(result.lines.join('\n'));
  assert.equal(result.total, PIN.of);
  assert.ok(result.passed >= PIN.min_pass, `held-out pass count ${result.passed} fell below ${PIN.min_pass}`);
});
