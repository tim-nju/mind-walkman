import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, parseRecord } from '../sync-model.js';
import { fields, MAX_EXPORT } from './service.mjs';
import { schema, transaction } from './db.mjs';
// Envelope v1 is the installed backup-kit's unmodified JSON/checksum protocol.
export async function restore(db, path) {
  if ((await stat(path)).size > MAX_EXPORT) throw new Error('backup_too_large');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > MAX_EXPORT) throw new Error('backup_too_large');
  const envelope = JSON.parse(text);
  fields(envelope, ['checksum','createdAt','format','payload','payloadSchema','projectId','sourceId','version']);
  if (envelope.format !== 'personal-backup' || envelope.version !== 1 ||
      envelope.projectId !== 'mind-walkman' || envelope.payloadSchema !== 1 ||
      typeof envelope.sourceId !== 'string' || !envelope.sourceId || envelope.sourceId.length > 128 ||
      typeof envelope.createdAt !== 'string' || !Number.isFinite(Date.parse(envelope.createdAt))) throw new Error('invalid_backup');
  const { checksum, ...body } = envelope;
  if (checksum !== createHash('sha256').update(canonical(body)).digest('hex')) throw new Error('backup_checksum_mismatch');
  const payload = envelope.payload;
  fields(payload, ['app','schema','watermark','trackKeySecret','records']);
  if (payload.app !== 'mind-walkman' || payload.schema !== 1 ||
      !Number.isSafeInteger(payload.watermark) || payload.watermark < 0 ||
      typeof payload.trackKeySecret !== 'string' || !/^[a-f0-9]{64}$/.test(payload.trackKeySecret) ||
      !Array.isArray(payload.records) || payload.records.length > payload.watermark) throw new Error('invalid_payload');
  const records = payload.records.map(parseRecord);
  if (new Set(records.map(record => record.key)).size !== records.length) throw new Error('duplicate_record_key');
  await schema(db);
  return transaction(db, async (t, owner) => {
    if (owner) throw new Error('restore_requires_empty_database');
    const sourceId = randomUUID();
    await t.query('INSERT INTO mw_owner(id,source_id,track_key_secret,seq) VALUES(1,$1,$2,$3)', [sourceId,payload.trackKeySecret,payload.watermark]);
    for (const [index, record] of records.entries()) await t.query('INSERT INTO mw_versions(owner_id,seq,key,record) VALUES(1,$1,$2,$3)', [index+1,record.key,record]);
    return { restored: true, sourceId, records: records.length, reauthorizationRequired: true };
  }, { empty: true });
}
