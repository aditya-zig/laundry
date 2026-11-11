import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('importing the product journey exposes run without starting a database or browser', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_UNPOOLED;
  delete env.LAUNDRY_SYNTHETIC_ACCEPTANCE;
  const file = fileURLToPath(new URL('./customer-v2-browser.cjs', import.meta.url));
  const script = `const driver = require(${JSON.stringify(file)}); if (typeof driver.run !== 'function') throw Error('Explicit run export required'); console.log('import-only');`;
  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'import-only');
  assert.equal(result.stderr, '');
});
