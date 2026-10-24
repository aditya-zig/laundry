import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkpointSamples } from './recording-checkpoint.mjs';
const names = ['booking', 'return-dispatch', 'return-proof', 'delivered'];
const marks = names.map((name, index) => ({ name, at: 1000 + 1000 * index }));

test('sample times come from actual asserted journey checkpoints, not arbitrary loading frames', () => {
  assert.deepEqual(checkpointSamples(marks, 0, 10), names.map((name, index) => ({ name, seconds: index + 1 })));
});

test('missing or duplicate real journey checkpoints cannot produce a recording receipt', () => {
  assert.throws(() => checkpointSamples(marks.slice(1), 0, 10), /Missing or repeated/);
  assert.throws(() => checkpointSamples([...marks, marks[0]], 0, 10), /Missing or repeated/);
});

test('invalid or out-of-video checkpoint clocks fail closed', () => {
  for (const at of [NaN, -1, 10000]) {
    assert.throws(() => checkpointSamples([{ name: 'booking', at }, ...marks.slice(1)], 0, 10), /outside captured timeline/);
  }
});
