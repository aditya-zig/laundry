import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createTaskPostgres } from './postgres.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function main() {
  if (git('status', '--porcelain')) throw new Error('Container evidence requires clean committed source');
  const revision = git('rev-parse', 'HEAD');
  await mkdir('.data', { recursive: true, mode: 0o700 });
  await mkdir('.verification', { recursive: true });
  await rm('.verification/container.json', { force: true });
  const log = resolve('.data/container-verification.log');
  await writeFile(log, '', { mode: 0o600 });
  async function docker(args, label, expected = 0, includeErrors = false) {
    console.log(label);
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 });
    await appendFile(log, `${label}\n${result.stdout ?? ''}\n${result.stderr ?? ''}\nexit=${result.status}\n`);
    if (result.error || result.status !== expected) throw new Error(`${label} failed; inspect private .data/container-verification.log`);
    return result.stdout + (includeErrors ? result.stderr : '');
  }
  // Do not send a workstation build context to an unrelated remote daemon.
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) throw new Error('A local Docker socket is required');
  if (process.env.BUILDX_BUILDER) throw new Error('Use the local context default builder, not an inherited custom builder');
  const endpoint = JSON.parse(await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], 'Check task-local Docker daemon'));
  if (!endpoint.startsWith('unix://')) throw new Error('A local Docker context is required');
  const directory = await mkdtemp(resolve('.data/container-check-'));
  const suffix = randomBytes(6).toString('hex');
  const image = `laundry-api-verification:${revision.slice(0, 12)}-${suffix}`;
  const container = `laundry-api-check-${suffix}`;
  const canaries = [join('apps/api', `.env.verify-${suffix}`), join('modules/shared', `verify-${suffix}.key`), join('packages/contracts', `verify-${suffix}.pem`)];
  let database, running = false, built = false, proof;
  try {
    for (const path of canaries) await writeFile(path, 'synthetic-context-canary-not-a-credential', { flag: 'wx', mode: 0o600 });
    const probe = join(directory, 'context.Dockerfile');
    await writeFile(probe, 'FROM scratch\nCOPY . /context\n');
    const exported = join(directory, 'export');
    await docker(['build', '--file', probe, '--output', `type=local,dest=${exported}`, '.'], 'Exercise the actual Docker build-context allowlist');
    for (const path of [...canaries, '.env', '.git/config', '.data/platform.env', '.verification/manifest.json', 'apps/api/dist/package.json']) {
      assert.equal(await exists(join(exported, 'context', path)), false, `Private/generated context path escaped: ${path}`);
    }
    for (const path of ['package.json', 'patches/metro@0.81.5.patch', 'tools/build-node.mjs', 'apps/api/src/main.ts', 'apps/customer/package.json', 'modules/schema/migrations/007_identity.sql']) {
      assert.equal(await exists(join(exported, 'context', path)), true, `Required build input omitted: ${path}`);
    }
    for (const path of canaries) await rm(path);
    assert.equal(git('status', '--porcelain'), '', 'Context probe changed source');
    await docker(['build', '--file', 'apps/api/Dockerfile', '--tag', image, '.'], 'Build the actual deployable Node image');
    built = true;
    const imageId = (await docker(['image', 'inspect', '--format', '{{.Id}}', image], 'Record immutable tested image identity')).trim();
    const invalidProduction = await docker(['run', '--rm', '--network', 'none', '--env', 'NODE_ENV=production', '--env', 'DEMO_MODE=false',
      '--env', 'DATABASE_URL=postgres://synthetic:synthetic@identity.invalid/laundry?sslmode=verify-full',
      '--env', 'CORS_ORIGIN=https://laundry.example.invalid', '--env', 'WHATSAPP_APP_SECRET=synthetic', '--env', 'WHATSAPP_VERIFY_TOKEN=synthetic',
      '--env', 'WHATSAPP_TOKEN=synthetic', '--env', 'WHATSAPP_PHONE_NUMBER_ID=synthetic', image], 'Verify missing production identity refuses boot', 1, true);
    // The failure message goes to stderr; the runtime must not announce listening.
    assert.match(invalidProduction, /configured Laundry identity provider/);
    assert.equal(invalidProduction.includes('listening on'), false);
    database = await createTaskPostgres({ runtime: 'docker', label: 'container-runtime' });
    const url = new URL(database.databaseUrl); url.port = '5432';
    const envFile = join(directory, 'runtime.env');
    await writeFile(envFile, `NODE_ENV=test\nDEMO_MODE=false\nDATABASE_URL=${url}\nDATABASE_URL_UNPOOLED=${url}\n`, { mode: 0o600 });
    await docker(['run', '--detach', '--rm', '--name', container, '--network', `container:${database.describe().container}`, '--env-file', envFile, image], 'Start compiled artifact against isolated PostgreSQL without demo credentials');
    running = true;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const probe = spawnSync('docker', ['exec', container, 'node', '-e', "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], { timeout: 5_000 });
      if (probe.status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(ready, true, 'Compiled container did not actually become live');
    const runtime = JSON.parse(await docker(['exec', container, 'node', '-e', `
      const assert=require('node:assert/strict'),fs=require('node:fs');
      const appRequire=require('node:module').createRequire('/app/api/package.json');
      assert.notEqual(process.getuid(),0);
      for(const name of ['tsx','typescript'])assert.throws(()=>appRequire.resolve(name));
      const store=fs.readdirSync('/app/api/node_modules/.pnpm');
      assert.equal(store.some(name=>/^(tsx|typescript|node-forge)@/.test(name)),false);
      for(const path of ['/app/.env','/app/.data','/app/.git','/app/api/src/main.ts'])assert.equal(fs.existsSync(path),false);
      (async()=>{
        const live=await fetch('http://127.0.0.1:4100/health');assert.equal(live.status,200);
        const ready=await fetch('http://127.0.0.1:4100/health/ready');assert.equal(ready.status,503);assert.equal((await ready.json()).productionReady,false);
        const auth=await fetch('http://127.0.0.1:4100/v2/identity/otp',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic-container-check'},body:JSON.stringify({phone:'+919000019876'})});
        assert.equal(auth.status,503);assert.equal((await auth.json()).code,'PROVIDER_UNAVAILABLE');
        const db=new (appRequire('pg').Pool)({connectionString:process.env.DATABASE_URL});
        try{assert.equal((await db.query('SELECT count(*)::int AS n FROM identity_otp_challenges')).rows[0].n,0);}finally{await db.end();}
        console.log(JSON.stringify({node:process.version,uid:process.getuid(),compiledStartup:true,developmentLoadersAbsent:true,productionDependenciesOnly:true,privateContextExcluded:true,unconfiguredIdentityClosed:true,productReady:false}));
      })().catch(()=>process.exit(1));
    `], 'Inspect the actual non-root, production-only runtime and fail-closed API'));
    proof = { testedSha: revision, dirty: false, checkedAt: new Date().toISOString(), imageId, runtime,
      scope: 'Compiled API container and isolated PostgreSQL; no SMS/provider calls; not whole-product production or native acceptance', productionReady: false };
  } finally {
    const failures = [];
    for (const path of canaries) try { await rm(path, { force: true }); } catch (error) { failures.push(error); }
    if (running) try { await docker(['stop', '--time', '15', container], 'Stop only the owned API container'); } catch (error) { failures.push(error); }
    if (database) try { await database.stop(); } catch (error) { failures.push(error); }
    if (built) try { await docker(['image', 'rm', image], 'Remove only the owned verification image tag'); } catch (error) { failures.push(error); }
    try { await rm(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
    if (failures.length) throw new Error('Owned container verification resources did not all clean up; inspect the private log');
  }
  assert.equal(git('status', '--porcelain'), '', 'Source changed during verification');
  await writeFile('.verification/container.json', JSON.stringify({ ...proof, cleanupCompleted: true }, null, 2));
  console.log('Compiled container/runtime/context verification passed; production ordering remains disabled.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
