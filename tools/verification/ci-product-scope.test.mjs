import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const workflow = async file => parse(await readFile(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
const requireSteps = (job, commands) => {
  assert.notEqual(job['continue-on-error'], true);
  for (const command of commands) {
    const step = job.steps.find(value => value.run === command);
    assert.ok(step, `${command} must not be dropped`);
    assert.equal(step.if, undefined, `${command} must not be conditional`);
    assert.notEqual(step['continue-on-error'], true);
  }
};

test('default current-app browser CI uses owned product scope without dropping prior regression or recording gates', async () => {
  for (const [file, name] of [['ci.yml','verify'], ['agent-verification.yml','browser-evidence']]) {
    const job = (await workflow(file)).jobs[name];
    assert.equal(job.env.VERIFY_WEB_SCOPE, 'product', `${file} must exercise current product apps`);
    assert.equal(job.env.LAUNDRY_PG_RUNTIME, 'docker');
    const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
    assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}', 'Recorded source must match the declared PR head, not an unlabelled merge commit');
    assert.equal(checkout.with['fetch-depth'], 0);
    for (const flag of ['LAUNDRY_VERIFY_OPS_FACILITY','LAUNDRY_VERIFY_RIDER','LAUNDRY_VERIFY_PICKUP']) assert.equal(job.env[flag], 'true');
    requireSteps(job, ['pnpm build','pnpm check','pnpm test:tooling','pnpm test','pnpm verify:browser']);
  }
  requireSteps((await workflow('ci.yml')).jobs.verify, ['pnpm check:convex','pnpm contracts:check','pnpm test:voice','pnpm verify:container','pnpm verify:isolation','pnpm verify:restore','pnpm verify:recording']);
});

test('restore CI uses the actual current-app source while retaining the separate legacy API-restart regression', async () => {
  assert.equal((await workflow('ci.yml')).jobs.verify.env.LAUNDRY_RESTORE_SOURCE, 'customer-v2');
  const pilot = (await workflow('agent-verification.yml')).jobs['pilot-evidence'];
  requireSteps(pilot, ['pnpm verify:pilot']);
  assert.equal(pilot.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  const source = await readFile(new URL('./run-pilot.mjs', import.meta.url), 'utf8');
  assert.match(source, /git\('merge-base', 'HEAD', 'origin\/main'\)/);
  assert.doesNotMatch(source, /origin\/chore\/cloud-agent-workflow/);
});
