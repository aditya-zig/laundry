import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, validateManifest, requireTestDatabase } from './evidence.mjs';

const sha = 'a'.repeat(40);
function report(status = 'passed', video = 'run.webm') {
  return { suites: [{ specs: [{ title: 'customer catalog', tests: [{ status: status === 'passed' ? 'expected' : 'unexpected', expectedStatus: 'passed', results: [{ status, attachments: [{ name: 'video', path: video, contentType: 'video/webm' }] }] }] }] }] };
}

test('evidence rejects stale commits, modified or missing videos and dirty workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'laundry-evidence-'));
  try {
    await writeFile(join(root, 'run.webm'), 'recorded media fixture');
    const manifest = await createManifest({ report: report(), root, headSha: sha, testedSha: sha, baseSha: 'b'.repeat(40), dirty: false });
    await validateManifest(manifest, { root, headSha: sha });
    await assert.rejects(validateManifest(manifest, { root, headSha: sha, requiredScenarios: ['SMOKE-RIDER'] }), /missing required scenario/i);
    await assert.rejects(validateManifest(manifest, { root, headSha: 'c'.repeat(40) }), /stale/i);
    await assert.rejects(validateManifest({ ...manifest, dirty: true }, { root, headSha: sha }), /dirty/i);
    await writeFile(join(root, 'run.webm'), 'changed after capture');
    await assert.rejects(validateManifest(manifest, { root, headSha: sha }), /hash|size/i);
    await rm(join(root, 'run.webm'));
    await assert.rejects(validateManifest(manifest, { root, headSha: sha }), /missing/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed, absent, skipped, retried or unrecorded scenarios cannot pass the evidence gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'laundry-evidence-'));
  try {
    await writeFile(join(root, 'run.webm'), 'recorded media fixture');
    for (const input of [report('failed'), { suites: [] }, report('skipped'), report('passed', '../escape.webm')]) {
      const manifest = await createManifest({ report: input, root, headSha: sha, testedSha: sha, baseSha: sha, dirty: false });
      await assert.rejects(validateManifest(manifest, { root, headSha: sha }), /scenario|video|path|pass/i);
    }
    const input = report(); input.suites[0].specs[0].tests[0].status = 'flaky';
    const manifest = await createManifest({ report: input, root, headSha: sha, testedSha: sha, baseSha: sha, dirty: false });
    await assert.rejects(validateManifest(manifest, { root, headSha: sha }), /pass|scenario/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('browser setup accepts only explicitly named loopback verification databases', () => {
  requireTestDatabase('postgres://test:test@127.0.0.1:5448/laundry_verify_ci');
  for (const url of ['', 'postgres://test:test@db.example.com/laundry_verify_ci', 'postgres://test:test@localhost/production']) {
    assert.throws(() => requireTestDatabase(url), /verification database/i);
  }
});
