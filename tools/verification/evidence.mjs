import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function requireTestDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('An explicit loopback verification database is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/laundry_verify_[a-zA-Z0-9_]+$/.test(url.pathname)) {
    throw new Error('Use a loopback verification database named laundry_verify_<run>, never a shared or production database.');
  }
}
function contained(root, file) {
  const path = resolve(root, file); const rel = relative(resolve(root), path);
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Video path escapes the evidence directory.');
  return path;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function testsFrom(suites) {
  return (suites ?? []).flatMap(suite => [...(suite.specs ?? []).flatMap(spec => (spec.tests ?? []).map(test => ({ spec, test }))), ...testsFrom(suite.suites)]);
}
export async function createManifest({ report, root, headSha, testedSha, baseSha, dirty }) {
  const scenarios = [];
  for (const { spec, test } of testsFrom(report.suites)) {
    const result = test.results?.at(-1); const videos = []; const errors = [];
    for (const attachment of result?.attachments ?? []) {
      if (attachment.name !== 'video') continue;
      try {
        const path = contained(root, attachment.path);
        if (!/\.(mp4|webm|mov)$/i.test(path)) throw new Error('Video file has an unsupported extension.');
        const bytes = await readFile(path);
        if (!bytes.length) throw new Error('Video file is empty.');
        videos.push({ path: relative(resolve(root), path), sizeBytes: bytes.length, sha256: digest(bytes) });
      } catch (error) { errors.push(`Missing or invalid video: ${error.message}`); }
    }
    scenarios.push({ id: spec.title, project: test.projectName ?? '', status: test.status === 'expected' && test.expectedStatus === 'passed' && result?.status === 'passed' && test.results.length === 1 ? 'passed' : 'failed', videos, errors });
  }
  return { version: 1, createdAt: new Date().toISOString(), headSha, baseSha, testedSha, dirty, runId: process.env.GITHUB_RUN_ID ?? 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1', scope: 'existing web smoke; not native or complete business acceptance', scenarios };
}
export async function validateManifest(manifest, { root, headSha, requireClean = true, requiredScenarios = [] }) {
  if (manifest.headSha !== headSha) throw new Error('Stale evidence: PR head SHA does not match.');
  for (const key of ['headSha', 'baseSha', 'testedSha']) if (!/^[a-f0-9]{40}$/.test(manifest[key] ?? '')) throw new Error(`Invalid evidence commit: ${key}`);
  if (requireClean && manifest.dirty !== false) throw new Error('Dirty workspace evidence cannot approve a published revision.');
  if (!manifest.scenarios?.length) throw new Error('No recorded scenarios in evidence.');
  for (const id of requiredScenarios) if (!manifest.scenarios.some(s => s.id.startsWith(id + ':'))) throw new Error(`Missing required scenario: ${id}`);
  for (const scenario of manifest.scenarios) {
    if (scenario.status !== 'passed' || scenario.errors?.length || !scenario.videos?.length) throw new Error(`Scenario did not pass with video: ${scenario.id}`);
    for (const video of scenario.videos) {
      let bytes;
      try { bytes = await readFile(contained(root, video.path)); } catch { throw new Error(`Missing video: ${video.path}`); }
      if (bytes.length !== video.sizeBytes || digest(bytes) !== video.sha256) throw new Error(`Video hash or size mismatch: ${video.path}`);
    }
  }
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
export async function writeEvidence({ exitCode = 0 } = {}) {
  const root = resolve('.verification');
  const report = JSON.parse(await readFile(resolve(root, 'results.json'), 'utf8'));
  const testedSha = git('rev-parse', 'HEAD');
  const manifest = await createManifest({ report, root, testedSha, headSha: process.env.VERIFY_HEAD_SHA ?? testedSha, baseSha: process.env.VERIFY_BASE_SHA || git('rev-parse', 'origin/build/laundry'), dirty: Boolean(git('status', '--porcelain')) });
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (exitCode !== 0) throw new Error(`Browser checks failed (exit ${exitCode}); diagnostic evidence retained.`);
  await validateManifest(manifest, { root, headSha: process.env.VERIFY_HEAD_SHA ?? testedSha, requireClean: process.env.VERIFY_ALLOW_DIRTY !== '1', requiredScenarios: ['SMOKE-CUSTOMER', 'SMOKE-RIDER', 'SMOKE-OPS'] });
  console.log('Verified current smoke recordings and manifest: .verification/manifest.json');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeEvidence().catch(error => { console.error(error.message); process.exitCode = 1; });
}
