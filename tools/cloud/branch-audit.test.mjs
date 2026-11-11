import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'branch-audit.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const commit = (cwd, message) => git(cwd, '-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '--allow-empty', '-m', message);

function tempRepo() {
  return mkdtempSync(join(tmpdir(), 'branch-audit-'));
}

test('passes with exit 0 when every branch tracks a synced local remote ref', () => {
  const dir = tempRepo();
  try {
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'one');
    const sha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    git(dir, 'update-ref', 'refs/remotes/origin/main', sha);
    git(dir, 'config', 'branch.main.remote', 'origin');
    git(dir, 'config', 'branch.main.merge', 'refs/heads/main');

    const run = spawnSync(process.execPath, [scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.branches, 1);
    assert.deepEqual(payload.findings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags a local-only branch, an upstream behind the tracked ref, and unpushed main', () => {
  const dir = tempRepo();
  try {
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'one');
    const synced = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    git(dir, 'update-ref', 'refs/remotes/origin/main', synced);
    git(dir, 'config', 'branch.main.remote', 'origin');
    git(dir, 'config', 'branch.main.merge', 'refs/heads/main');

    commit(dir, 'unpushed-main-work');
    git(dir, 'checkout', '-q', '-b', 'orphan-branch');
    commit(dir, 'no-remote-ever');

    const run = spawnSync(process.execPath, [scriptPath, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 2, `expected findings, got: ${run.stdout}\n${run.stderr}`);
    const payload = JSON.parse(run.stdout);
    const byBrane = Object.fromEntries(payload.findings.map((f) => [f.branch, f.kind]));
    assert.equal(byBrane.main, 'MAIN_UNPUSHED');
    assert.equal(byBrane['orphan-branch'], 'NO_UPSTREAM');
    assert.equal(payload.findings.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('flags an upstream gone and reports a human-readable list without --json', () => {
  const dir = tempRepo();
  try {
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'one');
    git(dir, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    git(dir, 'config', 'branch.main.remote', 'origin');
    git(dir, 'config', 'branch.main.merge', 'refs/heads/solo');
    // Deliberately no refs/remotes/origin/solo: the tracked upstream ref is absent.
    git(dir, 'config', 'branch.main.remote', 'origin');
    git(dir, 'config', 'branch.main.merge', 'refs/heads/solo');

    const run = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stdout, /main GONE_UPSTREAM/);
    assert.match(run.stdout, /which no longer exists under refs\/remotes/);
    assert.match(run.stdout, /1 local branches, 1 exposed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
