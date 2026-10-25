import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BASE, MODEL, TASKS, metadata, owned, parseResult } from './cloud-batch.mjs';
const catalogue = (cost = { input: 0, output: 0, cache: { read: 0, write: 0 } }) => `${MODEL}\n${JSON.stringify({ id: MODEL.split('/')[1], providerID: 'opencode', cost })}\nopencode/next\n{}`;
test('only an explicit zero-cost model with complete cost metadata can run', () => {
  assert.equal(metadata(catalogue()).cost.output, 0);
  for (const cost of [{ input: 0, output: 1, cache: { read: 0, write: 0 } }, { input: 0, output: 0 }, { input: 1, output: 0 }]) assert.throws(() => metadata(catalogue(cost)));
  assert.throws(() => metadata('opencode/not-this-model\n{}'));
});
test('task ownership is exclusive and directory patterns do not match sibling prefixes', () => {
  for (const [id, task] of Object.entries(TASKS)) {
    for (const pattern of task.paths) {
      const file = pattern.endsWith('/**') ? pattern.slice(0, -2) + 'probe.ts' : pattern;
      assert.equal(owned(file, task.paths), true);
      for (const [other, peer] of Object.entries(TASKS)) if (other !== id) assert.equal(owned(file, peer.paths), false, `${id}/${other}: ${file}`);
    }
  }
  assert.equal(owned('modules/billing/src/v2.ts', TASKS.B06.paths), false);
  assert.equal(owned('modules/jobs-other/secret', TASKS.B10.paths), false);
  assert.equal(owned('packages/contracts/src/v2/identity.ts', TASKS.C01.paths), false);
});
test('customer follow-up owns the actual grouped Expo entry and can mount its screens', () => {
  for (const path of ['apps/customer/app/(tabs)/index.tsx', 'apps/customer/app/(tabs)/account.tsx', 'apps/customer/app/_layout.tsx']) {
    assert.equal(owned(path, TASKS.F01.paths), true);
    for (const id of ['F03', 'F04', 'E03']) assert.equal(owned(path, TASKS[id].paths), false);
  }
});
test('provider errors, failed exits, truncation, unexpected cost and empty output cannot become successful dispatch receipts', () => {
  const good = [{ type: 'text', sessionID: 'session', part: { text: 'Report' } }, { type: 'step_finish', part: { reason: 'stop', cost: 0 } }].map(JSON.stringify).join('\n');
  assert.equal(parseResult(good, 0).steps, 1);
  assert.throws(() => parseResult(good, 124));
  assert.throws(() => parseResult('', 0));
  assert.throws(() => parseResult(good + '\n' + JSON.stringify({ type: 'text', part: { text: 'Maximum steps for this task have been reached. Work is incomplete.' } }), 0));
  for (const extra of [{ type: 'error', error: { message: 'Rate limited' } }, { type: 'step_finish', part: { reason: 'length' } }, { type: 'step_finish', part: { cost: 1 } }]) assert.throws(() => parseResult(good + '\n' + JSON.stringify(extra), 0));
});
test('dispatch is isolated, cannot cancel existing evidence, and has neither write permission nor inherited auth', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/cloud-workers.yml', import.meta.url), 'utf8');
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /max-parallel: 3/);
  assert.match(workflow, /options: \[all, F01, F03, F04, E03\]/);
  for (const lane of ['F01', 'F03', 'F04', 'E03']) assert.ok(workflow.includes(`inputs.lane == '${lane}' && '["${lane}"]'`));
  assert.doesNotMatch(workflow, /format\([^\n]*inputs\.lane/);
  assert.doesNotMatch(workflow, /secrets\.|contents: write|continue-on-error|git push/);
  assert.match(BASE, /^[a-f0-9]{40}$/);
});
