import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

for (const app of ['customer', 'partner']) {
  test(`${app} Metro resolves shared sessions to the compiled workspace boundary`, () => {
    const filename = fileURLToPath(new URL(`../../apps/${app}/metro.config.js`, import.meta.url));
    const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), require(name) {
      if (name === 'path') return path;
      if (name === 'expo/metro-config') return { getDefaultConfig: () => ({ resolver: {} }) };
      throw new Error(`Unexpected config dependency: ${name}`);
    } };
    // Exercise only our resolver map; actual Expo export is a separate build check.
    vm.runInNewContext(readFileSync(filename, 'utf8'), sandbox, { filename });
    const config = sandbox.module.exports;
    const resolved = config.resolver.resolveRequest({ resolveRequest() { throw new Error('Unexpected source fallback'); } }, '@laundry/app-foundation', 'web');
    assert.equal(resolved.type, 'sourceFile');
    assert.equal(resolved.filePath, fileURLToPath(new URL('../../packages/app-foundation/dist/index.js', import.meta.url)));
  });
}
