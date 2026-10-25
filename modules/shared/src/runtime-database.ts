import type { Pool } from 'pg';

const identityTables = ['identity_profiles', 'identity_otp_challenges', 'identity_rate_buckets', 'identity_session_families', 'identity_sessions', 'identity_command_results', 'identity_addresses', 'identity_audit'];

/** Runtime credentials must not also be migration/owner credentials. This checks
 * effective owner memberships as well as role flags, so NOINHERIT or an alias
 * cannot disguise the ability to SET ROLE into an owner. Never returns DSNs. */
export async function verifyRuntimeDatabase(db: Pool): Promise<void> {
  const tx = await db.connect();
  let discard = false;
  try {
    await tx.query('BEGIN READ ONLY');
    await tx.query("SET LOCAL statement_timeout='5s'");
    const role = (await tx.query(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      pg_has_role(current_user,d.datdba,'MEMBER') AS owns_database,
      has_database_privilege(current_database(),'CREATE') AS can_create,
      has_schema_privilege('public','CREATE') AS can_create_schema_objects
      FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`)).rows[0];
    if (!role || Object.values(role).some(Boolean)) throw new Error('Runtime database role must not have owner, schema-create, administrative or bypass privileges');
    const owned = (await tx.query(`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') AND pg_has_role(current_user,c.relowner,'MEMBER') LIMIT 1`)).rowCount;
    if (owned) throw new Error('Runtime database role must not own or inherit ownership of application objects');
    for (const table of identityTables) {
      const oid = (await tx.query("SELECT to_regclass($1)::oid AS oid", [`public.${table}`])).rows[0]?.oid;
      if (!oid) throw new Error('Required identity migration is missing; run the separate migration job');
      const access = (await tx.query(`SELECT has_table_privilege($1::oid,'TRUNCATE') AS truncation,
        has_table_privilege($1::oid,'TRIGGER') AS triggers`, [oid])).rows[0];
      // has_table_privilege with a list is true for ANY listed privilege; prove
      // every necessary grant separately rather than trusting the aggregate.
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        if (!(await tx.query('SELECT has_table_privilege($1::oid,$2) AS allowed', [oid, privilege])).rows[0].allowed) throw new Error('Runtime identity table grants are incomplete');
      }
      if (access.truncation || access.triggers) throw new Error('Runtime identity table grants must exclude destructive/DDL privileges');
    }
    await tx.query('COMMIT');
  } catch (error) {
    try { await tx.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { tx.release(discard); }
}
