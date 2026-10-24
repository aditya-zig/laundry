import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

// This tool cannot target the staging parent or an arbitrary production URL.
const HOST = 'ep-raspy-lab-a1ybw0w3.ap-southeast-1.aws.neon.tech';
const POOLED_HOST = 'ep-raspy-lab-a1ybw0w3-pooler.ap-southeast-1.aws.neon.tech';
const DATABASE = 'laundry_staging';
const ROLE = 'laundry_platform';

export async function provisionReadOnlyRole(client, password) {
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('A cryptographically generated database password is required');
  // Password alphabet and fixed identifiers make this DDL safe without logging credentials.
  // CREATE ROLE does not accept bind parameters.
  await client.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 5`);
  await client.query(`ALTER ROLE ${ROLE} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${ROLE} SET statement_timeout = '5s'`);
  await client.query(`ALTER ROLE ${ROLE} SET idle_in_transaction_session_timeout = '10s'`);
  await client.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${ROLE}`);
}

async function main() {
  const directory = resolve('.data');
  const output = resolve(directory, 'platform.env');
  // Never silently rotate an already deployed credential or overwrite a private file.
  try { await readFile(output); throw new Error('Platform credentials already exist; refusing implicit rotation'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const input = process.argv[2];
  if (!input) throw new Error('Pass a private file containing the provider-issued direct connection URL');
  let direct;
  try { direct = new URL((await readFile(input, 'utf8')).trim()); }
  catch { throw new Error('A valid private connection file is required'); }
  if (direct.hostname !== HOST || direct.pathname !== `/${DATABASE}` || direct.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Refusing to provision anywhere except the pinned release-candidate branch with verified TLS');
  }
  const password = randomBytes(32).toString('hex');
  const runtime = new URL(direct);
  runtime.hostname = POOLED_HOST;
  runtime.username = ROLE;
  runtime.password = password;
  const contents = `ORIGIN_SECRET=${randomBytes(32).toString('hex')}\nOPERATIONS_TOKEN=${randomBytes(32).toString('hex')}\nPLATFORM_DATABASE_URL=${runtime}\n`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const pending = output + '.pending';
  await writeFile(pending, contents, { mode: 0o600, flag: 'wx' });
  const db = new pg.Pool({ connectionString: direct.toString(), max: 1, connectionTimeoutMillis: 15000 });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: [state] } = await client.query(`SELECT current_database() AS database,
      (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM orders) AS orders`);
    if (state.database !== DATABASE || state.users !== 0 || state.orders !== 0) throw new Error('Candidate must be an empty, non-customer database');
    await provisionReadOnlyRole(client, password);
    await client.query('COMMIT');
    await rename(pending, output);
    console.log('Created a least-privilege platform role. Private credentials stored in ignored .data/platform.env (0600).');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); await db.end(); }
  const runtimePool = new pg.Pool({ connectionString: runtime.toString(), max: 1, connectionTimeoutMillis: 15000 });
  try {
    const { rows: [access] } = await runtimePool.query(`SELECT current_user AS role, current_setting('default_transaction_read_only') AS read_only,
      has_table_privilege(current_user, 'public.users', 'SELECT') AS can_read_users,
      has_table_privilege(current_user, 'public.orders', 'INSERT') AS can_write_orders,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`);
    if (access.role !== ROLE || access.read_only !== 'on' || access.can_read_users || access.can_write_orders || access.can_create) throw new Error('Runtime database permissions are not sufficiently restricted');
    console.log('Verified read-only runtime, no user reads, no order writes and no schema creation.');
  } finally { await runtimePool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message?.includes('postgres') ? 'Platform provisioning failed; private diagnostics withheld' : error.message); process.exitCode = 1; });
}
