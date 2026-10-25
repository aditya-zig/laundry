import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

async function runCheck(failOn, script = 'check') {
  const directory = await mkdtemp(join(tmpdir(), 'laundry-check-order-'));
  try {
    // Exercise the public shell sequence with stand-ins for compiler/package-manager
    // processes. A real clean-install run separately proves actual compilation.
    const tool = `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const args = process.argv.slice(2);
const name = basename(process.argv[1]);
const kind = name === 'node' ? 'tooling' : name === 'tsc' ? 'root' : args.includes('--filter') ? args[1].replace('@laundry/', '') : args.at(-1);
appendFileSync(join(process.env.PROBE_ROOT, 'calls'), kind + '\\n');
if (process.env.FAIL_ON === kind) process.exit(23);
const marker = join(process.env.PROBE_ROOT, 'contracts-built');
if (kind === 'contracts') {
  if (args.join(' ') !== '--filter @laundry/contracts build') process.exit(25);
  writeFileSync(marker, 'built');
} else if (!existsSync(marker)) process.exit(24);
`;
    for (const name of ['pnpm', 'tsc', 'node']) {
      const path = join(directory, name);
      await writeFile(path, tool);
      await chmod(path, 0o700);
    }
    const result = spawnSync('/bin/sh', ['-c', manifest.scripts[script]], {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`, PROBE_ROOT: directory, FAIL_ON: failOn ?? '' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.ifError(result.error);
    const calls = (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n');
    return { code: result.status, calls, stderr: result.stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('public check builds contracts before checking a clean workspace', async () => {
  const result = await runCheck();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.calls, ['contracts', 'root', 'check', 'typecheck']);
});

test('a failed prerequisite build prevents all downstream checks', async () => {
  const result = await runCheck('contracts');
  assert.equal(result.code, 23);
  assert.deepEqual(result.calls, ['contracts']);
});

test('a failed package check preserves its exit and stops later checks', async () => {
  const result = await runCheck('check');
  assert.equal(result.code, 23);
  assert.deepEqual(result.calls, ['contracts', 'root', 'check']);
});

test('consumer typecheck failures cannot become a successful public check', async () => {
  const result = await runCheck('typecheck');
  assert.equal(result.code, 23);
  assert.deepEqual(result.calls, ['contracts', 'root', 'check', 'typecheck']);
});

test('public tooling tests build contracts before executing Node on a fresh checkout', async () => {
  const result = await runCheck(undefined, 'test:tooling');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.calls, ['contracts', 'tooling']);
});

test('failed tooling prerequisites stop the suite with their original exit', async () => {
  const result = await runCheck('contracts', 'test:tooling');
  assert.equal(result.code, 23);
  assert.deepEqual(result.calls, ['contracts']);
});

test('failed Node tooling tests cannot be hidden by a successful build', async () => {
  const result = await runCheck('tooling', 'test:tooling');
  assert.equal(result.code, 23);
  assert.deepEqual(result.calls, ['contracts', 'tooling']);
});

test('public pilot verification builds the actual compiled API before launching it', async () => {
  const result = await runCheck(undefined, 'verify:pilot');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.calls, ['contracts', 'api-client', 'api', 'tooling']);
});

test('failed pilot API builds preserve their exit without starting browser evidence', async () => {
  const result = await runCheck('api', 'verify:pilot');
  assert.equal(result.code, 23);
  assert.deepEqual(result.calls, ['contracts', 'api-client', 'api']);
});

test('shared package checks include their test TypeScript projects', async () => {
  for (const name of ['contracts', 'api-client', 'test-fixtures', 'design-tokens']) {
    const packageRoot = new URL(`packages/${name}/`, root);
    const pkg = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
    assert.equal(pkg.scripts.check, 'tsc --noEmit -p tsconfig.json', name);
    const config = JSON.parse(await readFile(new URL('tsconfig.json', packageRoot), 'utf8'));
    assert.ok(config.include.includes('src/**/*.ts'), `${name} source coverage`);
    assert.ok(config.include.includes('test/**/*.ts'), `${name} test coverage`);
  }
});
