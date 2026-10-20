import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { requireTestDatabase, writeEvidence } from './evidence.mjs';

try {
  requireTestDatabase(process.env.DATABASE_URL);
  await mkdir('.verification', { recursive: true });
  // A failed launch must never reuse results from an earlier revision.
  await rm('.verification/results.json', { force: true });
  await rm('.verification/manifest.json', { force: true });
  const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  await writeEvidence({ exitCode: result.status ?? 1 });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
