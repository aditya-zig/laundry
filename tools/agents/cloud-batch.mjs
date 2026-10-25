import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const BASE = '16eddf74e29945932a8042d2aae88c944ea6c9f1';
export const MODEL = 'opencode/glm-5.3-flash-free';
export const TASKS = {
  B05: { paths: ['modules/billing/src/v2.ts', 'modules/billing/src/v2-errors.ts', 'modules/billing/src/index.ts', 'apps/api/src/features/billing-v2/**', 'apps/api/test/billing-v2.test.ts', 'modules/schema/proposals/B05.sql', 'docs/implementation/handoffs/B05/**'], test: 'billing-v2', goal: 'Review and repair inherited billing candidate: immutable captures, no duplicate economic effects, pending/unknown outcomes, role/facility boundaries, refund reservation races and sum limits. No invented provider integration. Preserve v1 exports. Do not edit contracts or OrdersService.' },
  B06: { paths: ['modules/logistics/src/v2.ts', 'modules/logistics/src/v2-errors.ts', 'modules/logistics/src/index.ts', 'apps/api/src/features/logistics-v2/**', 'apps/api/test/logistics-v2.test.ts', 'modules/schema/proposals/B06.sql', 'docs/implementation/handoffs/B06/**'], test: 'logistics-v2', goal: 'Review and repair inherited custody candidate: assigned-only visibility, revoked/reassigned rider denial including cached/offline commands, hashed expiring codes, bounded attempts, both legs/container history, no return completion without authoritative settlement and accepted custody. Provider unknown outcomes must not blindly rebook. No invented vendor API.' },
  B08: { paths: ['modules/support/**', 'modules/reviews/**', 'apps/api/src/features/support/**', 'apps/api/src/features/reviews/**', 'apps/api/test/support-reviews-v2.test.ts', 'modules/schema/proposals/B08.sql', 'docs/implementation/handoffs/B08/**'], test: 'support-reviews-v2', goal: 'Review and repair inherited support/reviews candidate: ownership, facility scopes, append-only messages/resolutions, no premature incident closure, one review per delivered order, consent/moderation audit, stale version and idempotency races. Do not claim real media or payment peers from fixtures.' },
  B09: { paths: ['modules/conversations/src/v2.ts', 'modules/conversations/src/v2-errors.ts', 'modules/conversations/src/index.ts', 'apps/api/src/features/conversations-v2/**', 'apps/api/test/conversations-v2.test.ts', 'modules/schema/proposals/B09.sql', 'docs/implementation/handoffs/B09/**'], test: 'conversations-v2', goal: 'Review/finish inherited conversation candidate; write missing real PostgreSQL tests. Verify raw-body authenticated inbound events, provider replay, secure identity links, revision+quote+expiry confirmation, no stale/double booking, opt out, human handoff and minimized audio/transcripts. Do not call speech/WhatsApp/SMS or guess vendor transport.' },
  B10: { paths: ['modules/jobs/**', 'apps/worker/src/jobs.ts', 'apps/api/src/features/jobs/**', 'apps/api/test/jobs-v2.test.ts', 'modules/schema/proposals/B10.sql', 'docs/implementation/handoffs/B10/**'], test: 'jobs-v2', goal: 'Review/repair inherited durable worker: PostgreSQL lease fencing and SKIP LOCKED, crash/restart, bounded retries, dead letters, authorized replay, permanent event dedupe, deletion failure recovery. Side effects outside long transactions and no notification rollback of business effects. No live provider calls.' },
  C01: { paths: ['docs/implementation/handoffs/C01/BATCH-AUDIT.md'], goal: 'Read-only architecture/contract audit of the FULL candidate: actual class/controller APIs vs packages/contracts/src/v2/ports.ts, DTOs, SDK, registry, error/role sets, migrations and transaction boundaries. Inspect B01-B10 and app consumers. Write concrete file/line findings and additive change requests in BATCH-AUDIT.md. Do not change contracts or freeze them; coordinator owns those files. Do not call incomplete inventory a production implementation.' },
  D01: { paths: ['packages/design-tokens/**', 'packages/ui/**', 'docs/design/production/**', 'docs/implementation/handoffs/D01/**'], goal: 'Implement design-foundation candidate for all three apps with existing stack. Read .agents/skills/design-taste-frontend/SKILL.md and references/app-screens.md COMPLETELY. Follow existing Framed sheet seed 1278588346 and navy/teal; no resampling without documented constraint. Build semantic token/state/copy/custody-receipt specs and reusable controls where existing manifests support them (do not add root dependencies). Include customer booking/tracking, rider task/handover and operations queue/intake reference HTML in docs/design/production, self-contained no fabricated business approvals or ratings. Run committed taste draw/lint; real browser inspect if available, otherwise BLOCKED_ENV, never claim screenshots inspected. Do not edit app routes.' },
  F00: { paths: ['docs/implementation/handoffs/F00/FOUNDATION-AUDIT.md'], goal: 'Read-only app foundation audit across customer, partner and ops. Produce exact route/file ownership map, SDK session/refresh/retry/storage wiring design and missing SDK/contract requests. Preserve existing UI WIP and stack. Read F00-F04 packets and taste app-screen skill. Identify raw fetch, fake auth, divergent prices and offline-success traps with file/line evidence. Do not edit apps before contract/design freeze.' },
  E02: { paths: ['docs/implementation/handoffs/E02/NATIVE-PREFLIGHT.md'], goal: 'Read-only Android whole-product build/readiness audit. Inspect customer/partner Expo config, native permissions, secure session/offline persistence, camera/location/notification paths, scripts and CI. Identify exact missing prerequisites, free reproducible build/emulator commands and required device scenarios. No app store uploads, purchases, billing, accounts, signing keys, full SDK installation or claims of native acceptance. State what was actually run vs blocked.' },
};
export function owned(path, patterns) {
  return patterns.some(pattern => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
}
export function metadata(text, model = MODEL) {
  const marker = model + '\n';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('Explicit free model is unavailable');
  const tail = text.slice(start + marker.length);
  const next = tail.search(/\nopencode\//);
  const data = JSON.parse(next < 0 ? tail.trim() : tail.slice(0, next).trim());
  if (data.providerID !== 'opencode' || data.id !== model.split('/')[1] || data.cost?.input !== 0 || data.cost?.output !== 0 || data.cost?.cache?.read !== 0 || data.cost?.cache?.write !== 0) throw new Error('Free model cost check failed; no invocation permitted');
  return data;
}
export function parseResult(text, code) {
  const messages = [], errors = [], sessions = new Set();
  let steps = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.sessionID) sessions.add(event.sessionID);
    if (event.type === 'error') errors.push(event.error?.message ?? 'Provider failure');
    if (event.type === 'step_finish') {
      steps++;
      if (event.part?.reason === 'length') errors.push('Truncated model response');
      if (event.part?.cost > 0) errors.push('Unexpected positive model cost');
    }
    if (event.type === 'text' && event.part?.text) messages.push(event.part.text);
  }
  if (code !== 0 || errors.length || !messages.length || !steps) throw new Error(`Delegate did not complete: exit=${code}; ${errors.join('; ') || 'missing terminal output'}`);
  return { messages, steps, sessions: [...sessions] };
}
async function run(bin, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(bin, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => done({ code, stdout, stderr }));
  });
}
export async function main(id, executable) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Cloud workers may run only on isolated GitHub runners');
  const task = TASKS[id]; if (!task || !executable) throw new Error('Explicit known task and executable required');
  const root = process.cwd(), output = resolve(root, '.verification/cloud-batch', id);
  await mkdir(output, { recursive: true });
  const git = (...args) => run('git', args);
  const head = (await git('rev-parse', 'HEAD')).stdout.trim();
  const status = await git('status', '--porcelain');
  if (status.code || status.stdout) throw new Error('Cloud delegate requires a clean source snapshot');
  const digest = createHash('sha256').update(await readFile('packages/contracts/openapi-v2.json')).digest('hex');
  const home = resolve(process.env.RUNNER_TEMP ?? '/tmp', `laundry-agent-${id}`);
  await mkdir(home, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: resolve(home, 'config'), XDG_DATA_HOME: resolve(home, 'data'), XDG_CACHE_HOME: resolve(home, 'cache'), CI: 'true', DATABASE_URL: process.env.DATABASE_URL, DEMO_MODE: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true' };
  const edit = { '*': 'deny', ...Object.fromEntries(task.paths.map(path => [path, 'allow'])) };
  const config = { '$schema': 'https://opencode.ai/config.json', share: 'disabled', autoupdate: false, snapshot: false, enabled_providers: ['opencode'], model: MODEL, small_model: MODEL, provider: { opencode: { whitelist: [MODEL.split('/')[1]] } }, mcp: {}, plugin: [], permission: { '*': 'deny', read: { '*': 'allow', '**/.env*': 'deny', '**/.data/**': 'deny', '**/.verification/**': 'deny' }, glob: 'allow', grep: 'allow', list: 'allow', edit, bash: { '*': 'deny', 'pwd': 'allow', 'ls *': 'allow', 'rg *': 'allow', 'find *': 'allow', 'pnpm *': 'allow', 'node --test *': 'allow', 'node .agents/skills/design-taste-frontend/scripts/*': 'allow' }, task: 'deny', skill: 'allow', webfetch: 'deny', websearch: 'deny', question: 'deny' }, agent: { build: { model: MODEL, steps: 45 }, title: { model: MODEL }, summary: { model: MODEL }, compaction: { model: MODEL } } };
  const originalConfig = await readFile('opencode.json');
  const receipt = { task: id, executor: 'OpenCode on GitHub-hosted isolated runner', model: MODEL, baseSha: BASE, sourceSha: head, testedSha: null, wireTarget: 'laundry-wire-v2.0.0-candidate', openapiSha256: digest, paths: task.paths, productionReady: false, status: 'STARTING' };
  let failure;
  try {
    await writeFile('opencode.json', JSON.stringify(config, null, 2));
    const catalogue = await run('timeout', ['--kill-after=10s', '90s', executable, 'models', 'opencode', '--verbose'], { env });
    if (catalogue.code) throw new Error('Free-model catalogue retrieval failed');
    const selected = metadata(catalogue.stdout);
    await writeFile(resolve(output, 'model.json'), JSON.stringify(selected, null, 2));
    const prompt = `You are isolated cloud task ${id}, source ${head}, inherited baseline ${BASE}, candidate OpenAPI SHA256 ${digest}. Latest user authorizes full-project subagents. This is review/repair of RECOVERED UNINTEGRATED candidate source, not a C01-approved feature dispatch, contract freeze, completed B01-B10 task or production readiness. Read AGENTS.md, docs/specs/product-spec.md, docs/specs/contracts.md, docs/implementation/production-application/{IMPLEMENTATION.md,CLOUD-AGENTS.md,CONTRACTS-V2.md,issues/${id}.md}. Own ONLY ${task.paths.join(', ')}. ${task.goal}\nPreserve unrelated files. Coordinator owns root manifests/lock/CI, packages/contracts, SDK, canonical migrations, composition and merges. NEVER git commit/push, PR, deploy, paid or provider/model/network call, commercial integration, another agent or account settings. Use existing pnpm only, no dependency installation. Only external providers may be faked. Use DATABASE_URL disposable PostgreSQL, never change it or use another database. Write failing focused behavior regressions before fixes, then run pnpm --filter @laundry/api exec vitest run ${task.test ?? 'THIS_TASK_DOES_NOT_OWN_API_TESTS'} if applicable and scoped typecheck, preserve failure exits. Every test suite touching proposal tables must initialize its proposal itself. A source snapshot with incomplete peers is not a passing baseline; report unrelated blockers, do not edit peer files. Write precise handoff within allowlist: changed files, commands/results, scenarios, fixture/live modes, remaining blockers, source SHA, actual tested working tree status. Do not claim passing tests from code inspection or old handoffs. Never claim successful browser/native/provider/physical acceptance you did not perform. Return concise results and critical integration requests. Stop once bounded slice and handoff are complete.`;
    const result = await run('timeout', ['--signal=TERM', '--kill-after=20s', '14m', executable, 'run', '--model', MODEL, '--agent', 'build', '--format', 'json', '--title', `Laundry ${id} cloud repair ${head.slice(0,7)}`, prompt], { env });
    await writeFile(resolve(output, 'events.jsonl'), result.stdout); await writeFile(resolve(output, 'stderr.log'), result.stderr);
    receipt.exitCode = result.code;
    const parsed = parseResult(result.stdout, result.code);
    receipt.sessions = parsed.sessions; receipt.steps = parsed.steps;
    await writeFile(resolve(output, 'result.md'), parsed.messages.join('\n\n'));
    receipt.status = 'RETURNED_FOR_REVIEW';
  } catch (error) { failure = error; receipt.status = 'FAILED'; receipt.failure = String(error.message); }
  finally { await writeFile('opencode.json', originalConfig); }
  if ((await git('rev-parse', 'HEAD')).stdout.trim() !== head) { failure = new Error('Delegate changed source history'); receipt.status = 'FAILED_OWNERSHIP'; receipt.failure = failure.message; }
  const tracked = await git('diff', 'HEAD', '--name-only');
  const untracked = await git('ls-files', '--others', '--exclude-standard');
  const changed = [...new Set((tracked.stdout + '\n' + untracked.stdout).split('\n').filter(Boolean))];
  receipt.changedFiles = changed;
  const unauthorized = changed.filter(path => !owned(path, task.paths));
  if (unauthorized.length) { failure = new Error('Delegate wrote outside ownership: ' + unauthorized.join(', ')); receipt.status = 'FAILED_OWNERSHIP'; receipt.failure = failure.message; }
  // Include new files in the review patch without creating a commit or giving
  // the delegate repository credentials. The isolated checkout is disposable.
  if (!unauthorized.length && changed.length) {
    const add = await git('add', '--intent-to-add', '--', ...changed);
    if (add.code) failure = new Error('Could not construct review patch');
    const patch = await git('diff', 'HEAD', '--binary');
    if (patch.code) failure = new Error('Could not export review patch');
    await writeFile(resolve(output, 'changes.patch'), patch.stdout);
    receipt.patchSha256 = createHash('sha256').update(patch.stdout).digest('hex');
  }
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  if (failure) throw failure;
  console.log(`${id}: delegate returned; coordinator review and integrated acceptance still required`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) main(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
