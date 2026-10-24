import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserViewport, recordingSampleIsUsable } from './viewports.mjs';

test('normal acceptance retains phone and operations viewport sizes', () => {
  assert.deepEqual(browserViewport(false), { width: 390, height: 844 });
  assert.deepEqual(browserViewport(false, true), { width: 1280, height: 800 });
});

test('every recorded role uses the full desktop without resizing to phone-width windows', () => {
  assert.deepEqual(browserViewport(true), { width: 1904, height: 960 });
  assert.deepEqual(browserViewport(true, true), browserViewport(true));
});

test('a narrow bright browser on mostly black canvas fails despite acceptable mean brightness', () => {
  assert.equal(recordingSampleIsUsable({ meanLuma: 64, blackPercent: 75 }), false);
  assert.equal(recordingSampleIsUsable({ meanLuma: 200, blackPercent: 8 }), true);
  assert.equal(recordingSampleIsUsable({ meanLuma: 0, blackPercent: 100 }), false);
});

test('unmeasured or invalid recording content cannot pass', () => {
  for (const sample of [{ meanLuma: 100 }, { meanLuma: NaN, blackPercent: 5 }, { meanLuma: 100, blackPercent: -1 }, { meanLuma: 100, blackPercent: Infinity }]) {
    assert.equal(recordingSampleIsUsable(sample), false);
  }
});
