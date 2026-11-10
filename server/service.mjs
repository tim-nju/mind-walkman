import { randomBytes, randomUUID } from 'node:crypto';
import { canonical, parseOperation, parseRecord, mergeRecord, MAX_BATCH } from '../sync-model.js';
import { hash, transaction, HttpError } from './db.mjs';
export const MAX_BODY = 256 * 1024, MAX_EXPORT = 64 * 1024 * 1024, PAGE = 100;
const fail = (status, code) => { throw new HttpError(status, code); };
export function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail(400, 'invalid_fields');
}
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function number(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail(400, 'invalid_cursor');
  return Number(value);
}
async function authenticate(t, bearer, purpose, pending = false) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer || '')) fail(401, 'not_authorized');
  const { rows } = await t.query('SELECT * FROM mw_credentials WHERE owner_id=1 AND token_hash=$1 AND purpose=$2', [hash(bearer), purpose]);
  const row = rows[0];
  if (!row || row.revoked_at || (!row.authorized_at && (!pending || +row.expires_at <= Date.now()))) fail(401, 'not_authorized');
  return row;
}
function pagination(query, owner) {
  for (const key of query.keys()) if (!['cursor','through','source'].includes(key) || query.getAll(key).length !== 1) fail(400, 'invalid_query');
  const cursor = number(query.get('cursor') ?? '0');
  const through = query.has('through') ? number(query.get('through')) : null;
  if ((cursor > 0 && (through === null || !query.has('source'))) || (query.has('source') && query.get('source') !== owner.source_id)) fail(409, 'source_changed');
  const watermark = through ?? Number(owner.seq);
  if (cursor > watermark || watermark > Number(owner.seq)) fail(409, 'source_changed');
  return { cursor, watermark };
}
export function createService(db) {
  return async function handle({ path, method, body, bearer, query }) {
    return transaction(db, async (t, owner) => {
      if (method === 'POST' && path === '/api/device/activate') {
        fields(body, ['schema','activationSecret','tokenHash']);
        if (body.schema !== 1 || !hex(body.activationSecret) || !hex(body.tokenHash)) fail(400, 'invalid_activation');
        const activation = (await t.query('SELECT * FROM mw_activation WHERE owner_id=1 AND secret_hash=$1', [hash(body.activationSecret)])).rows[0];
        if (!activation) fail(401, 'invalid_activation');
        if (activation.token_hash) {
          if (activation.token_hash !== body.tokenHash) fail(409, 'activation_consumed');
          const row = (await t.query('SELECT revoked_at FROM mw_credentials WHERE owner_id=1 AND token_hash=$1 AND purpose=$2', [body.tokenHash,'device'])).rows[0];
          if (!row || row.revoked_at) fail(401, 'not_authorized');
          return { activated: true };
        }
        if (+activation.expires_at <= Date.now()) fail(401, 'invalid_activation');
        let previous;
        if (bearer !== undefined) {
          if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) fail(401, 'not_authorized');
          previous = (await t.query("SELECT id FROM mw_credentials WHERE owner_id=1 AND token_hash=$1 AND purpose='device'", [hash(bearer)])).rows[0];
          if (!previous) fail(401, 'not_authorized');
        }
        if ((await t.query('SELECT 1 FROM mw_credentials WHERE token_hash=$1 UNION ALL SELECT 1 FROM mw_activation WHERE token_hash=$1 LIMIT 1', [body.tokenHash])).rowCount) fail(409, 'credential_exists');
        if (previous) {
          await t.query("UPDATE mw_credentials SET token_hash=$2,revoked_at=NULL WHERE owner_id=1 AND id=$1 AND purpose='device'", [previous.id,body.tokenHash]);
        } else {
          await t.query("INSERT INTO mw_credentials(token_hash,owner_id,id,purpose,authorized_at) VALUES($1,1,$2,'device',now())", [body.tokenHash,randomUUID()]);
        }
        await t.query('UPDATE mw_activation SET token_hash=$2 WHERE secret_hash=$1 AND owner_id=1', [hash(body.activationSecret), body.tokenHash]);
        return { activated: true };
      }
      if (method === 'POST' && path === '/api/backup/pair') {
        fields(body, ['tokenHash','label']);
        if (!hex(body.tokenHash) || typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80) fail(400, 'bad_backup_pair');
        if ((await t.query('SELECT 1 FROM mw_credentials WHERE token_hash=$1', [body.tokenHash])).rowCount) fail(409, 'backup_pair_exists');
        await t.query("DELETE FROM mw_credentials WHERE owner_id=1 AND purpose='backup' AND authorized_at IS NULL AND expires_at<now()");
        if (Number((await t.query("SELECT count(*) AS n FROM mw_credentials WHERE owner_id=1 AND purpose='backup' AND authorized_at IS NULL")).rows[0].n) >= 30) fail(429, 'too_many_attempts');
        const id = randomUUID(), code = randomBytes(5).toString('hex').toUpperCase(), expiresAt = new Date(Date.now()+600000).toISOString();
        await t.query("INSERT INTO mw_credentials(token_hash,owner_id,id,purpose,label,pair_code_hash,expires_at) VALUES($1,1,$2,'backup',$3,$4,$5)", [body.tokenHash,id,body.label.trim(),hash(code),expiresAt]);
        return { id, code, expiresAt };
      }
      const backup = path.startsWith('/api/backup/');
      const credential = await authenticate(t, bearer, backup ? 'backup' : 'device', backup && ['/api/backup/status','/api/backup/disconnect'].includes(path));
      if (method === 'POST' && ['/api/device/disconnect','/api/backup/disconnect'].includes(path)) {
        fields(body, []);
        await t.query('UPDATE mw_credentials SET revoked_at=now() WHERE owner_id=1 AND id=$1', [credential.id]);
        return { ok: true };
      }
      if (method === 'GET' && path === '/api/device/bootstrap') return { schema: 1, actorId: credential.id, sourceId: owner.source_id, trackKeySecret: owner.track_key_secret };
      if (method === 'GET' && path === '/api/backup/status') return { id: credential.id, authorized: !!credential.authorized_at, expiresAt: credential.expires_at };
      if (method === 'POST' && path === '/api/backup/receipt') {
        fields(body, ['checksum','savedAt']);
        if (!hex(body.checksum) || typeof body.savedAt !== 'string' || !Number.isFinite(Date.parse(body.savedAt)) || Date.parse(body.savedAt)>Date.now()+60000) fail(400, 'bad_backup_receipt');
        await t.query('UPDATE mw_credentials SET last_saved_at=$2,last_checksum=$3 WHERE owner_id=1 AND id=$1', [credential.id,body.savedAt,body.checksum]);
        return { ok: true, cloudSync: 'unverified' };
      }
      if (method === 'POST' && path === '/api/sync/push') {
        fields(body, ['schema','sourceId','operations']);
        if (body.schema !== 1 || typeof body.sourceId !== 'string' || !Array.isArray(body.operations)) fail(400, 'invalid_push');
        if (body.sourceId !== owner.source_id) fail(409, 'source_changed');
        if (body.operations.length > MAX_BATCH) fail(413, 'batch_too_large');
        const operations = body.operations.map(parseOperation), acknowledged = [];
        for (const op of operations) {
          if (op.actor !== credential.id) fail(400, 'actor_mismatch');
          const serialized = canonical(op);
          const previous = (await t.query('SELECT body FROM mw_operations WHERE owner_id=1 AND op_id=$1', [op.opId])).rows[0];
          if (previous) {
            if (previous.body !== serialized) fail(409, 'operation_conflict');
          } else {
            const current = (await t.query('SELECT record FROM mw_versions WHERE owner_id=1 AND key=$1 ORDER BY seq DESC LIMIT 1', [op.record.key])).rows[0]?.record;
            const record = mergeRecord(current, op.record);
            if (!current || canonical(current) !== canonical(record)) {
              owner.seq = Number(owner.seq)+1;
              if (!Number.isSafeInteger(owner.seq)) fail(409, 'sequence_exhausted');
              await t.query('INSERT INTO mw_versions(owner_id,seq,key,record) VALUES(1,$1,$2,$3)', [owner.seq,record.key,record]);
            }
            await t.query('INSERT INTO mw_operations(owner_id,op_id,body) VALUES(1,$1,$2)', [op.opId,serialized]);
          }
          acknowledged.push(op.opId);
        }
        await t.query('UPDATE mw_owner SET seq=$1 WHERE id=1', [owner.seq]);
        return { schema: 1, sourceId: owner.source_id, acknowledged };
      }
      if (method === 'GET' && ['/api/sync/pull','/api/backup/export'].includes(path)) {
        const { cursor, watermark } = pagination(query, owner);
        const latest = 'SELECT DISTINCT ON (key) seq,record FROM mw_versions WHERE owner_id=1 AND seq<=$1 ORDER BY key,seq DESC';
        // Export totals are calculated over the same immutable watermark on every page.
        const totals = backup ? (await t.query(`SELECT count(*) AS n,coalesce(sum(octet_length(record::text)),0) AS bytes FROM (${latest}) v`, [watermark])).rows[0] : null;
        if (totals && Number(totals.bytes) + Number(totals.n) + 4096 > MAX_EXPORT) fail(413, 'backup_too_large');
        const rows = (await t.query(backup
          ? `SELECT seq,record FROM (${latest}) v WHERE seq>$2 ORDER BY seq LIMIT $3`
          : 'SELECT seq,record FROM mw_versions WHERE owner_id=1 AND seq<=$1 AND seq>$2 ORDER BY seq LIMIT $3', [watermark,cursor,PAGE+1])).rows;
        const more = rows.length > PAGE, page = rows.slice(0,PAGE);
        const nextCursor = more ? Number(page.at(-1).seq) : watermark;
        const records = page.map(row => ({ seq: Number(row.seq), record: parseRecord(row.record) }));
        if (!backup) return { schema: 1, sourceId: owner.source_id, watermark, nextCursor, more, records };
        await t.query('UPDATE mw_credentials SET last_read_at=now() WHERE owner_id=1 AND id=$1', [credential.id]);
        return { protocol: 1, projectId: 'mind-walkman', payloadSchema: 1, sourceId: owner.source_id, watermark, totalCount: Number(totals.n), nextCursor, more, collection: 'records',
          payloadHeader: { app: 'mind-walkman', schema: 1, watermark, trackKeySecret: owner.track_key_secret }, records: records.map(row => row.record) };
      }
      fail(404, 'not_found');
    });
  };
}
