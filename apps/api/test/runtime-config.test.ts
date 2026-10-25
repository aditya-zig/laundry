import { describe, expect, it } from 'vitest';
import { assertManagedDatabaseAliases, assertProductionConfig, resolveCorsOrigins } from '../src/runtime-config';

const production = {
  NODE_ENV: 'production', DEMO_MODE: 'false',
  DATABASE_URL: 'postgres://test:synthetic@db.example.invalid/laundry?sslmode=verify-full',
  CORS_ORIGIN: 'https://customer.example.invalid,https://ops.example.invalid/',
  WHATSAPP_APP_SECRET: 'synthetic', WHATSAPP_VERIFY_TOKEN: 'synthetic', WHATSAPP_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: 'synthetic',
};

describe('production runtime boundaries', () => {
  it('permits explicit messaging deferral, not implicitly absent or misspelled configuration', () => {
    const deferred = { ...production, LAUNDRY_WHATSAPP_MODE: 'disabled', LAUNDRY_IDENTITY_PROVIDER: 'disabled', WHATSAPP_APP_SECRET: '', WHATSAPP_VERIFY_TOKEN: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '' };
    expect(() => assertProductionConfig(deferred)).not.toThrow();
    expect(() => assertProductionConfig({ ...deferred, LAUNDRY_WHATSAPP_MODE: '' })).toThrow(/WHATSAPP/);
    expect(() => assertProductionConfig({ ...deferred, LAUNDRY_WHATSAPP_MODE: 'disbaled' })).toThrow(/Unsupported/);
  });
  it('never conceals provider-injected owner credentials behind the restricted runtime URL', () => {
    const expected = production.DATABASE_URL;
    const owner = 'postgres://owner:private-value@db.example.invalid/laundry?sslmode=verify-full';
    for (const supplied of [{ DATABASE_URL: owner, DATABASE_URL_UNPOOLED: expected }, { DATABASE_URL: expected, DATABASE_URL_UNPOOLED: owner }]) {
      const env = { ...supplied, LAUNDRY_RUNTIME_DATABASE_URL: expected };
      expect(() => assertManagedDatabaseAliases(env)).toThrow(/must match/);
      expect(env.DATABASE_URL_UNPOOLED).toEqual(supplied.DATABASE_URL_UNPOOLED);
    }
    expect(() => assertManagedDatabaseAliases({ DATABASE_URL: expected })).toThrow(/must match/);
    const env = { DATABASE_URL: expected, DATABASE_URL_UNPOOLED: expected, LAUNDRY_RUNTIME_DATABASE_URL: expected };
    assertManagedDatabaseAliases(env); expect(env.DATABASE_URL_UNPOOLED).toBeUndefined();
    expect(() => assertProductionConfig({ ...production, ...env })).not.toThrow();
  });
  it('production allows only configured exact HTTPS origins, never inherited localhost defaults', () => {
    expect(resolveCorsOrigins(production)).toEqual(['https://customer.example.invalid', 'https://ops.example.invalid']);
    expect(() => assertProductionConfig(production)).not.toThrow();
  });
  it.each(['*', 'http://customer.example.invalid', 'https://localhost', 'https://127.0.0.1', 'https://customer.example.invalid/path', 'https://user:secret@customer.example.invalid', 'https://customer.example.invalid?token=private', 'null'])('refuses unsafe production origin %s', origin => {
    expect(() => resolveCorsOrigins({ ...production, CORS_ORIGIN: origin })).toThrow();
  });
  it('requires explicit production origins while retaining opt-in development previews', () => {
    expect(() => resolveCorsOrigins({ NODE_ENV: 'production' })).toThrow(/exact HTTPS/);
    expect(resolveCorsOrigins({ NODE_ENV: 'test' })).toContain('http://localhost:8081');
    expect(resolveCorsOrigins({ NODE_ENV: 'test', CORS_ORIGIN: 'http://127.0.0.1:8888/' })).toContain('http://127.0.0.1:8888');
  });
  it.each(['postgres://user:private@localhost/laundry?sslmode=verify-full', 'postgres://user:private@db.example.invalid/laundry?sslmode=require', 'postgres://user:private@db.example.invalid/laundry', 'https://db.example.invalid/laundry'])('rejects unsafe production database configuration without reflecting credentials', database => {
    try { assertProductionConfig({ ...production, DATABASE_URL: database }); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(Error); if (error instanceof Error) { expect(error.message).toContain('PostgreSQL'); expect(error.message).not.toContain('private'); } }
  });
  it('does not permit migration credentials or migration authority inside the production API', () => {
    expect(() => assertProductionConfig({ ...production, DATABASE_URL_UNPOOLED: production.DATABASE_URL })).toThrow(/Migration credentials/);
    expect(() => assertProductionConfig({ ...production, LAUNDRY_ALLOW_MIGRATIONS: 'true' })).toThrow(/Migration credentials/);
  });

  it('requires explicit non-demo operation and configured production messaging', () => {
    expect(() => assertProductionConfig({ ...production, DEMO_MODE: 'true' })).toThrow(/DEMO_MODE/);
    expect(() => assertProductionConfig({ ...production, WHATSAPP_TOKEN: '' })).toThrow(/WHATSAPP_TOKEN/);
  });
});
