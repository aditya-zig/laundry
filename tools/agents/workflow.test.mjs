import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskPacket, cloudArgs, openCodeArgs, parseOpenCodeResult } from './workflow.mjs';

test('task packet includes issue body, plan status and video requirement without assuming approval', () => {
  const packet = buildTaskPacket({ issue: 'Show a service detail with retry behavior.', branch: 'issue/12', planVersion: '0.3' });
  assert.match(packet, /Show a service detail with retry behavior/);
  assert.match(packet, /0\.3/);
  assert.match(packet, /partner review pending/i);
  assert.match(packet, /watchable video/i);
  assert.match(packet, /issue\/12/);
  assert.throws(() => buildTaskPacket({ issue: '', branch: 'issue/12' }), /issue body/i);
});

test('cloud submission requires an explicit environment before any launch', () => {
  assert.throws(() => cloudArgs({ prompt: 'task', branch: 'issue/12' }), /environment/i);
  assert.deepEqual(cloudArgs({ env: 'env-123', branch: 'issue/12', prompt: 'literal $(touch nope)' }),
    ['cloud', 'exec', '--env', 'env-123', '--branch', 'issue/12', '--attempts', '1', 'literal $(touch nope)']);
});

test('both OpenCode roles select the exact Muse model and explicit agent', () => {
  assert.deepEqual(openCodeArgs('planner', 'plan it'), ['run', '--standalone', '--model', 'openrouter/meta/muse-spark-1.3', '--agent', 'laundry-planner', '--format', 'json', 'plan it']);
  assert.equal(openCodeArgs('tooling', 'implement it')[5], 'laundry-tooling');
  assert.throws(() => openCodeArgs('unknown', 'task'), /role/i);
});

test('partial provider failures and truncated output cannot become successful agent receipts', () => {
  const partial = JSON.stringify({ type: 'text', part: { text: 'partial result' } });
  const failure = JSON.stringify({ type: 'error', error: { message: 'quota exhausted' } });
  assert.throws(() => parseOpenCodeResult(`${partial}\n${failure}`, 0), /quota exhausted/);
  assert.throws(() => parseOpenCodeResult(partial, 1), /exit 1/);
  assert.throws(() => parseOpenCodeResult(`${partial}\n${JSON.stringify({ type: 'step_finish', part: { reason: 'length' } })}`, 0), /truncated/i);
  assert.throws(() => parseOpenCodeResult('', 0), /empty/i);
  assert.deepEqual(parseOpenCodeResult(JSON.stringify({ type: 'text', sessionID: 'ses_123', part: { text: 'Complete result.' } }), 0), { text: 'Complete result.', sessions: ['ses_123'] });
});
