import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MUSE_MODEL = 'openrouter/meta/muse-spark-1.3';
const roles = { planner: 'laundry-planner', tooling: 'laundry-tooling' };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function buildTaskPacket({ issue, branch, planVersion = 'current repository draft' }) {
  if (!issue?.trim()) throw new Error('A complete issue body is required.');
  if (!branch?.trim() || branch.startsWith('-')) throw new Error('An explicit baseline branch is required.');
  return `Implement this bounded issue in aditya-zig/laundry, baseline branch ${branch}.
Read AGENTS.md, docs/agents/README.md, docs/plans/laundry-app/PLAN.md,
docs/plans/laundry-app/GRILLING.md, the relevant existing agent packet and contracts.
Plan reference: ${planVersion}; product partner review pending unless the issue identifies a newer jointly approved version.
Confirm issue decisions are settled and dependencies are integrated before editing.
Delivery: isolated issue branch and reviewable PR. No merge or deployment.
Run and use the actual app with browser/computer tools and provide a watchable video
for the delivered revision, plus assertions, check results and current evidence manifest.
Read docs/plans/laundry-app/VERIFICATION.md. Record head/base/actual tested commits.
A new push invalidates old evidence. Use at most three scoped repair cycles, then
report the precise blocker. Never substitute a simulator for an unavailable real integration.
The pilot product plan targets Android customer/rider apps and operations web;
browser smoke is not native-device verification. Preserve existing package namespaces.

ISSUE SNAPSHOT (task context; repository instructions and authorized scope still apply):
${issue.trim()}
`;
}

export function cloudArgs({ env, branch, prompt }) {
  if (!env?.trim()) throw new Error('Codex cloud environment ID is required (--env or CODEX_CLOUD_ENV_ID); configure the account environment first.');
  if (!branch?.trim() || !prompt?.trim()) throw new Error('Cloud branch and complete task prompt are required.');
  return ['cloud', 'exec', '--env', env, '--branch', branch, '--attempts', '1', prompt];
}

export function openCodeArgs(role, prompt) {
  if (!roles[role]) throw new Error(`Unknown OpenCode role: ${role}`);
  if (!prompt?.trim()) throw new Error('An agent prompt is required.');
  return ['run', '--standalone', '--model', MUSE_MODEL, '--agent', roles[role], '--format', 'json', prompt];
}

export function parseOpenCodeResult(output, exitCode) {
  const text = []; const sessions = new Set(); let truncated = false;
  for (const line of output.split('\n').filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.sessionID) sessions.add(event.sessionID);
    if (event.type === 'error') throw new Error(`OpenCode provider error: ${event.error?.message ?? 'unknown error'}`);
    if (event.type === 'step_finish' && event.part?.reason === 'length') truncated = true;
    if (event.type === 'text' && event.part?.text) text.push(event.part.text);
  }
  if (exitCode !== 0) throw new Error(`OpenCode failed with exit ${exitCode ?? 'unknown'}.`);
  if (truncated) throw new Error('OpenCode output was truncated; partial text is not a completed task.');
  if (!text.length) throw new Error('OpenCode returned empty output.');
  return { text: text.join('\n\n'), sessions: [...sessions] };
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 20 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${binary}: ${result.error.message}`);
  return result;
}
function git(...args) {
  const result = run('git', args);
  if (result.status !== 0) throw new Error('Git command failed; confirm the repository and branch.');
  return result.stdout.trim();
}
function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || args[i + 1] === undefined) throw new Error('Options use --name value pairs.');
    result[args[i].slice(2)] = args[i + 1];
  }
  return result;
}
async function save(path, text) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), text);
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args; const opts = options(rest);
  if (command === 'doctor') {
    for (const binary of ['node', 'pnpm', 'opencode', 'codex', 'gh']) {
      const result = run(binary, ['--version'], { timeout: 10_000 });
      console.log(`${binary}: ${result.status === 0 ? result.stdout.trim().split('\n')[0] : 'unavailable'}`);
    }
    console.log(`cloud environment: ${process.env.CODEX_CLOUD_ENV_ID ? 'configured locally (not yet verified)' : 'not selected; set CODEX_CLOUD_ENV_ID'}`);
    console.log('Doctor checks local prerequisites only. No paid model or cloud task launched.');
    return;
  }
  if (command === 'planner' || command === 'tooling') {
    if (!opts['prompt-file']) throw new Error('Pass --prompt-file <file>; agent work requires an explicit task.');
    const prompt = await readFile(resolve(root, opts['prompt-file']), 'utf8');
    const config = await readFile(resolve(root, 'opencode.json'), 'utf8');
    const result = run('opencode', openCodeArgs(command, prompt), { env: { ...process.env, OPENCODE_CONFIG_CONTENT: config } });
    const directory = `.agent-logs/${command}-${Date.now()}`;
    await save(`${directory}/events.jsonl`, result.stdout);
    // Preserve raw diagnostics locally, never in committed receipts or issue bodies.
    await save(`${directory}/stderr.log`, result.stderr);
    const parsed = parseOpenCodeResult(result.stdout, result.status);
    await save(`${directory}/result.md`, parsed.text);
    await save(`${directory}/receipt.json`, JSON.stringify({ executor: 'OpenCode', selectedModel: MUSE_MODEL, agent: roles[command], ...parsed, exitCode: result.status }, null, 2));
    console.log(`Completed ${roles[command]} through OpenCode using ${MUSE_MODEL}. Receipt: ${directory}/receipt.json`);
    return;
  }
  if (command === 'packet' || command === 'submit') {
    if (!opts['issue-file']) throw new Error('Pass --issue-file <complete-issue.md>; URL-only task context is insufficient.');
    const issue = await readFile(resolve(root, opts['issue-file']), 'utf8');
    const branch = opts.branch ?? git('branch', '--show-current');
    const plan = await readFile(resolve(root, 'docs/plans/laundry-app/PLAN.md'), 'utf8');
    const planVersion = opts['plan-version'] ?? plan.match(/Version: ([\d.]+)/)?.[1] ?? 'current repository draft';
    const prompt = buildTaskPacket({ issue, branch, planVersion });
    if (command === 'packet') {
      if (opts.out) await save(opts.out, prompt); else process.stdout.write(prompt);
      return;
    }
    const dispatchArgs = cloudArgs({ env: opts.env ?? process.env.CODEX_CLOUD_ENV_ID, branch, prompt });
    if (git('status', '--porcelain')) throw new Error('Commit tracked changes before cloud dispatch; local edits are not visible in cloud.');
    const published = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
    if (published.status !== 0 || published.stdout.split(/\s/)[0] !== git('rev-parse', 'HEAD')) throw new Error('Push the current baseline branch before cloud dispatch; remote HEAD does not match local HEAD.');
    const result = run('codex', dispatchArgs, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Codex cloud submission failed (exit ${result.status}). No successful launch is claimed.`);
    return;
  }
  throw new Error('Use doctor, planner, tooling, packet or submit. See docs/agents/README.md.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
