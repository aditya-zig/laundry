import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteSessionStores, openNativeSqliteSessionStores } from '../src/sqlite-stores';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function database() {
  const directory = mkdtempSync(join(tmpdir(), 'laundry-storage-'));
  temporary.push(directory);
  const path = join(directory, 'test.sqlite');
  function open() {
    const connection = new DatabaseSync(path);
    return { connection, port: {
      async execAsync(sql: string) { connection.exec(sql); },
      async runAsync(sql: string, ...params: string[]) { return connection.prepare(sql).run(...params); },
      async getFirstAsync(sql: string, ...params: string[]) { return connection.prepare(sql).get(...params) ?? null; },
      async getAllAsync(sql: string, ...params: string[]) { return connection.prepare(sql).all(...params); },
    } };
  }
  return open;
}
const record = () => ({ idempotencyKey: 'd1f02261-01b3-462a-9df6-7bc52fd118ae',
  actorId: 'e7ae2297-3fdd-4e8e-bd5a-5c51cd2deacd', identityKey: 'customer-scope',
  routeId: 'logistics.rider.handover', params: {},
  bodyJson: JSON.stringify({ code: '123456', containerIds: Array.from({ length: 100 }, (_, i) => `981ebfe2-43bf-4f52-8db2-${String(i).padStart(12, '0')}`) }),
  createdAt: '2026-10-26T20:00:00.000Z' });

describe('native open guards (synthetic capability only; no device encryption proof)', () => {
  it('does not generate or replace a key when a journal already exists without its device key', async () => {
    let generated = false, opened = false;
    await expect(openNativeSqliteSessionStores({
      deviceKey: { async read() { return null; }, async write() { throw Error('must not write'); } },
      async databaseExists() { return true; },
      async newDatabaseKey() { generated = true; return 'a'.repeat(64); },
      async openDatabase() { opened = true; throw Error('must not open'); },
    })).rejects.toThrow(/no device key/);
    expect(generated).toBe(false); expect(opened).toBe(false);
  });
  it('rejects plain SQLite before writing a key or creating a sensitive data table', async () => {
    const db = database()();
    let written = false, closed = false;
    try {
      await expect(openNativeSqliteSessionStores({
        deviceKey: { async read() { return null; }, async write() { written = true; } },
        async databaseExists() { return false; }, async newDatabaseKey() { return 'a'.repeat(64); },
        async openDatabase() { return { ...db.port, async closeAsync() { closed = true; } }; },
      })).rejects.toThrow(/no SQLCipher/);
      expect(written).toBe(false); expect(closed).toBe(true);
      expect(db.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    } finally { db.connection.close(); }
  });
  it('does not create a new empty journal when its previously retained device key exists', async () => {
    let opened = false;
    await expect(openNativeSqliteSessionStores({
      deviceKey: { async read() { return 'a'.repeat(64); }, async write() { throw Error('must not replace'); } },
      async databaseExists() { return false; }, async newDatabaseKey() { throw Error('must not generate'); },
      async openDatabase() { opened = true; throw Error('must not open'); },
    })).rejects.toThrow(/device key has no journal/);
    expect(opened).toBe(false);
  });
  it('rejects malformed device keys before opening the journal', async () => {
    await expect(openNativeSqliteSessionStores({
      deviceKey: { async read() { return "not-a-key'; DROP TABLE pending_commands"; }, async write() { throw Error('must not write'); } },
      async databaseExists() { return true; }, async newDatabaseKey() { throw Error('must not replace'); },
      async openDatabase() { throw Error('must not open'); },
    })).rejects.toThrow(/device key is invalid/);
  });
  it('verifies key persistence before any key/data SQL, then initializes in the correct order', async () => {
    let key: string | null = null;
    const statements: string[] = [];
    let closed = false;
    await openNativeSqliteSessionStores({
      deviceKey: { async read() { return key; }, async write(value) { key = value; } },
      async databaseExists() { return false; }, async newDatabaseKey() { return 'a'.repeat(64); },
      async openDatabase() { return {
        async getFirstAsync() { return { cipher_version: 'synthetic-capability-only' }; },
        async execAsync(sql) { expect(key).toBe('a'.repeat(64)); statements.push(sql); },
        async runAsync() { throw Error('not used'); }, async getAllAsync() { return []; }, async closeAsync() { closed = true; },
      }; },
    });
    expect(statements[0]).toBe(`PRAGMA key = "x'${'a'.repeat(64)}'";`);
    expect(statements[1]).toContain('synchronous = FULL');
    expect(statements[2]).toContain('CREATE TABLE');
    expect(closed).toBe(false);
  });
  it('closes and preserves recovery state if SecureStore write/readback fails', async () => {
    let sql = false, closed = false;
    await expect(openNativeSqliteSessionStores({
      deviceKey: { async read() { return null; }, async write() { /* simulated silent failure */ } },
      async databaseExists() { return false; }, async newDatabaseKey() { return 'a'.repeat(64); },
      async openDatabase() { return {
        async getFirstAsync() { return { cipher_version: 'synthetic-capability-only' }; },
        async execAsync() { sql = true; }, async runAsync() {}, async getAllAsync() { return []; }, async closeAsync() { closed = true; },
      }; },
    })).rejects.toThrow(/not securely persisted/);
    expect(sql).toBe(false); expect(closed).toBe(true);
  });
});

describe('SQL journal semantics (ordinary host SQLite; not native encryption proof)', () => {
  it('retains exact refresh/rotation data and a large command after closing and reopening the database', async () => {
    const open = database();
    let db = open();
    const first = await createSqliteSessionStores(db.port);
    const credentials = JSON.stringify({ version: 1, refreshToken: 'synthetic-refresh', refreshKey: 'same-rotation-key' });
    await first.refreshTokenStore.write(credentials);
    const intent = record();
    expect(Buffer.byteLength(intent.bodyJson)).toBeGreaterThan(2048);
    await first.pendingMutationStore.add(intent);
    db.connection.close();
    db = open();
    try {
      const restored = await createSqliteSessionStores(db.port);
      expect(await restored.refreshTokenStore.read()).toBe(credentials);
      expect(await restored.pendingMutationStore.list()).toEqual([intent]);
    } finally { db.connection.close(); }
  });
  it('accepts exact duplicate persistence but cannot overwrite an existing key with new intent', async () => {
    const db = database()();
    try {
      const stores = await createSqliteSessionStores(db.port), intent = record();
      await stores.pendingMutationStore.add(intent);
      await stores.pendingMutationStore.add(structuredClone(intent));
      await expect(stores.pendingMutationStore.add({ ...intent, actorId: 'different-actor' })).rejects.toThrow(/intent/i);
      await expect(stores.pendingMutationStore.add({ ...intent, bodyJson: '{}' })).rejects.toThrow(/intent/i);
      expect(await stores.pendingMutationStore.list()).toEqual([intent]);
    } finally { db.connection.close(); }
  });
  it('fails closed on a corrupt retained row instead of pretending the journal is empty', async () => {
    const db = database()();
    try {
      const stores = await createSqliteSessionStores(db.port);
      await stores.pendingMutationStore.add(record());
      db.connection.exec("UPDATE pending_commands SET value = 'broken-json'");
      await expect(stores.pendingMutationStore.list()).rejects.toThrow(/journal|pending|persist/i);
    } finally { db.connection.close(); }
  });
  it('rejects a retained row whose SQL key differs from the JSON intent key', async () => {
    const db = database()();
    try {
      const stores = await createSqliteSessionStores(db.port);
      await stores.pendingMutationStore.add(record());
      db.connection.prepare('UPDATE pending_commands SET value = ?').run(JSON.stringify({ ...record(), idempotencyKey: 'replacement-key' }));
      await expect(stores.pendingMutationStore.list()).rejects.toThrow(/key does not match/);
    } finally { db.connection.close(); }
  });
  it('removes only the requested key and persists explicit clearing across recreation', async () => {
    const db = database()();
    try {
      let stores = await createSqliteSessionStores(db.port);
      const first = record(), second = { ...record(), idempotencyKey: 'second-synthetic-key' };
      await stores.pendingMutationStore.add(first);
      await stores.pendingMutationStore.add(second);
      await stores.pendingMutationStore.remove(first.idempotencyKey);
      expect(await stores.pendingMutationStore.list()).toEqual([second]);
      await stores.refreshTokenStore.write('synthetic-token');
      await stores.refreshTokenStore.write(null);
      await stores.pendingMutationStore.clear();
      stores = await createSqliteSessionStores(db.port);
      expect(await stores.refreshTokenStore.read()).toBeNull();
      expect(await stores.pendingMutationStore.list()).toEqual([]);
    } finally { db.connection.close(); }
  });
});
