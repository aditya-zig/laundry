import { spawn, execFileSync } from 'node:child_process';
import { mkdir, open, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createManifest, validateManifest, requireTestDatabase } from './evidence.mjs';

// Job-owned services and database only. Never attach to an existing API.
requireTestDatabase(process.env.DATABASE_URL);
const root = resolve('.verification/pilot');
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const testedSha = git('rev-parse', 'HEAD');
const headSha = process.env.VERIFY_HEAD_SHA || testedSha;
const baseSha = process.env.VERIFY_BASE_SHA || git('merge-base', 'HEAD', 'origin/chore/cloud-agent-workflow');
const dirty = Boolean(git('status', '--porcelain'));
const apiPort = Number(process.env.PILOT_VERIFY_API_PORT || 4110);
const consolePort = Number(process.env.PILOT_VERIFY_CONSOLE_PORT || 5185);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const consoleUrl = `http://127.0.0.1:${consolePort}/`;
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort), NODE_ENV: 'test',
  DEMO_MODE: 'true', PILOT_ENABLED: 'true', API_ORIGIN: apiOrigin,
  PILOT_API_URL: apiOrigin, PILOT_CONSOLE_URL: consoleUrl, PILOT_EVIDENCE_DIR: root };
const live = new Set();
async function launch(command, args, name, overrides = {}) {
  const handle = await open(resolve(root, `${name}.log`), 'a');
  // spawn needs a file descriptor number; a lazily opened WriteStream has none yet.
  const child = spawn(command, args, { env: { ...env, ...overrides }, detached: true, stdio: ['ignore', handle.fd, handle.fd] });
  child.result = new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', (code, signal) => { handle.close().catch(() => {}); live.delete(child); done({ code, signal }); });
  });
  live.add(child);
  return child;
}
async function stop(child) {
  if (!live.has(child)) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5_000);
  try { await child.result; } finally { clearTimeout(timer); }
}
async function ready(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!live.has(child)) throw new Error(`Service exited before readiness: ${url}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`Service not ready: ${url}`);
}
async function command(script, args = [], overrides = {}) {
  const child = await launch('node', [script, ...args], script.split('/').at(-1), overrides);
  const timeout = setTimeout(() => { void stop(child); }, 180_000);
  try {
    const { code, signal } = await child.result;
    if (code !== 0) throw new Error(`${script} failed (${signal || code}); see ${root}`);
  } finally { clearTimeout(timeout); }
}
let failure;
let passed = false;
try {
  let api = await launch('pnpm', ['--filter', '@laundry/api', 'start'], 'api');
  await ready(`${apiOrigin}/v1/services`, api);
  const console = await launch('pnpm', ['--filter', '@laundry/pilot-console', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(consolePort), '--strictPort'], 'console');
  await ready(consoleUrl, console);
  await command('tools/verification/pilot-console.mjs', [], { PILOT_API_URL: `${apiOrigin}/v1` });
  const summary = JSON.parse(await readFile(resolve(root, 'summary.json'), 'utf8'));
  await stop(api);
  api = await launch('pnpm', ['--filter', '@laundry/api', 'start'], 'api-restarted');
  await ready(`${apiOrigin}/v1/services`, api);
  await command('tools/verification/check-persistence.mjs', [summary.paidOrder.id, summary.heldOrder.id], { PILOT_API_URL: `${apiOrigin}/v1`, PILOT_REVIEWER_ORDER_ID: '' });
  passed = true;
} catch (error) { failure = error; }
finally { for (const child of [...live]) await stop(child); }
const report = { suites: [{ specs: [{ title: 'PILOT-JOURNEY: booking, price consent, paid return and unprocessed hold', tests: [{
  status: passed ? 'expected' : 'unexpected', expectedStatus: 'passed', projectName: 'pilot',
  results: [{ status: passed ? 'passed' : 'failed', attachments: [{ name: 'video', path: 'pilot-flow.webm' }] }],
}] }] }] };
const manifest = await createManifest({ report, root, headSha, testedSha, baseSha, dirty });
manifest.scope = 'kg pilot browser journey and API restart persistence; synthetic demo, not live integrations or native';
manifest.failure = failure?.message;
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (failure) throw failure;
await validateManifest(manifest, { root, headSha, requireClean: process.env.VERIFY_ALLOW_DIRTY !== '1', requiredScenarios: ['PILOT-JOURNEY'] });
console.log(`Pilot evidence verified for ${headSha}: ${root}/manifest.json`);
