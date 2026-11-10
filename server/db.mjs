import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('hex');
export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
export function database(connectionString) {
  if (!connectionString) throw new Error('database_url_required');
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000 });
}
export async function schema(db) {
  await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
export async function transaction(db, fn, { empty = false } = {}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Also protects initialization/restore while there is no owner row to lock.
    if (empty) await client.query("SELECT pg_advisory_xact_lock(730819011)");
    const { rows } = await client.query('SELECT * FROM mw_owner WHERE id=1 FOR UPDATE');
    if (!empty && !rows[0]) throw new HttpError(503, 'service_not_initialized');
    const result = await fn(client, rows[0]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export async function initialize(db) {
  await schema(db);
  return transaction(db, async (t, owner) => {
    if (owner) return { initialized: true, sourceId: owner.source_id };
    const sourceId = randomUUID();
    await t.query('INSERT INTO mw_owner(id,source_id,track_key_secret) VALUES(1,$1,$2)', [sourceId, secret()]);
    return { initialized: true, sourceId };
  }, { empty: true });
}
export async function issueActivation(db) {
  return transaction(db, async t => {
    const activationSecret = secret(), expiresAt = new Date(Date.now() + 900000).toISOString();
    await t.query('INSERT INTO mw_activation(secret_hash,owner_id,expires_at) VALUES($1,1,$2)', [hash(activationSecret), expiresAt]);
    return { activationSecret, expiresAt };
  });
}
export async function approveBackup(db, code) {
  if (typeof code !== 'string' || !/^[A-F0-9]{10}$/.test(code)) throw new HttpError(400, 'bad_backup_code');
  return transaction(db, async t => {
    const { rows } = await t.query('UPDATE mw_credentials SET authorized_at=now(),pair_code_hash=NULL WHERE owner_id=1 AND purpose=$1 AND pair_code_hash=$2 AND revoked_at IS NULL AND authorized_at IS NULL AND expires_at>now() RETURNING id,label', ['backup', hash(code)]);
    if (!rows[0]) throw new HttpError(400, 'bad_backup_code');
    return { ok: true, ...rows[0] };
  });
}
export async function revoke(db, id) {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new HttpError(400, 'bad_credential_id');
  return transaction(db, async t => {
    const result = await t.query('UPDATE mw_credentials SET revoked_at=now() WHERE owner_id=1 AND id=$1 RETURNING id', [id]);
    if (!result.rowCount) throw new HttpError(404, 'credential_not_found');
    return { ok: true };
  });
}
