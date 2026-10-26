import { join } from 'node:path';

/** Archive only a live disposable TaskPostgres context. Never accept an arbitrary
 * DATABASE_URL. Passwords stay out of subprocess argv, logs and public receipts. */
export function taskArchiveCommand(context, tool, { binDir, env = process.env } = {}) {
  if (!['pg_dump', 'pg_restore'].includes(tool)) throw new Error('Unsupported archive tool');
  const state = context.describe();
  const url = new URL(context.databaseUrl);
  if (state.status !== 'running' || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^laundry_verify_[a-z0-9_]+$/.test(state.database) || url.pathname !== `/${state.database}` ||
      Number(url.port) !== state.port || url.search || url.hash || !url.username || !url.password) {
    throw new Error('Archive requires the matching running loopback task database');
  }
  const args = ['-U', decodeURIComponent(url.username), '-d', state.database];
  if (state.runtime === 'docker') {
    if (!/^laundry-pg-[a-z0-9-]+$/.test(state.container ?? '')) throw new Error('Invalid task container');
    return { file: 'docker', args: ['exec', ...(tool === 'pg_restore' ? ['-i'] : []), state.container, tool, ...args], env: { ...env } };
  }
  if (state.runtime !== 'local') throw new Error('Unsupported task PostgreSQL runtime');
  // Clear inherited libpq connection/service/SSL settings; explicit loopback
  // arguments must not be redirected through a personal service or hostaddr.
  const safeEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('PG')));
  return {
    file: binDir ? join(binDir, tool) : tool,
    args: ['-h', url.hostname.replace(/^\[|\]$/g, ''), '-p', String(state.port), ...args],
    env: { ...safeEnv, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '10' },
  };
}
