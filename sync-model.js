// Shared wire contract. Only opaque track keys and listening state cross this boundary.
export const MAX_BATCH = 100;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const trackPattern = /^track:[0-9a-f]{64}$/;
export class SyncDataError extends Error {
  constructor(code) { super(code); this.name = 'SyncDataError'; this.code = code; }
}
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new SyncDataError('invalid_fields');
  }
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new SyncDataError('invalid_integer');
  return value;
}
function parseStamp(value) {
  object(value, ['origin', 'counter', 'actor', 'sample']);
  if (!['legacy', 'live'].includes(value.origin) || !uuid.test(value.actor)) throw new SyncDataError('invalid_stamp');
  return { origin: value.origin, counter: integer(value.counter), actor: value.actor, sample: integer(value.sample) };
}
export function parseRecord(value) {
  if (!value || typeof value !== 'object') throw new SyncDataError('invalid_record');
  switch (value.kind) {
    case 'track':
      object(value, ['kind', 'key', 'stamp', 'positionMs', 'furthestMs', 'durationMs', 'completed']);
      if (!trackPattern.test(value.key) || typeof value.completed !== 'boolean') throw new SyncDataError('invalid_track');
      return {
        kind: 'track', key: value.key, stamp: parseStamp(value.stamp),
        positionMs: integer(value.positionMs), furthestMs: integer(value.furthestMs),
        durationMs: integer(value.durationMs), completed: value.completed
      };
    case 'setting':
      object(value, ['kind', 'key', 'stamp', 'value']);
      switch (value.key) {
        case 'speed':
          if (![0.8, 1, 1.25, 1.5, 2].includes(value.value)) throw new SyncDataError('invalid_speed');
          break;
        case 'loop':
          if (!['normal', 'one'].includes(value.value)) throw new SyncDataError('invalid_loop');
          break;
        case 'lastTrack':
          if (!trackPattern.test(value.value)) throw new SyncDataError('invalid_last_track');
          break;
        default: throw new SyncDataError('invalid_setting');
      }
      return { kind: 'setting', key: value.key, stamp: parseStamp(value.stamp), value: value.value };
    default: throw new SyncDataError('invalid_kind');
  }
}
export function parseOperation(value) {
  object(value, ['schema', 'opId', 'actor', 'record']);
  if (value.schema !== 1 || !uuid.test(value.opId) || !uuid.test(value.actor)) throw new SyncDataError('invalid_operation');
  const record = parseRecord(value.record);
  if (record.stamp.actor !== value.actor) throw new SyncDataError('actor_mismatch');
  return { schema: 1, opId: value.opId, actor: value.actor, record };
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function compareStamp(left, right) {
  if (left.origin !== right.origin) return left.origin === 'live' ? 1 : -1;
  if (left.counter !== right.counter) return left.counter < right.counter ? -1 : 1;
  if (left.actor !== right.actor) return left.actor < right.actor ? -1 : 1;
  return left.sample === right.sample ? 0 : left.sample < right.sample ? -1 : 1;
}
export function mergeRecord(left, right) {
  const incoming = parseRecord(right);
  if (!left) return incoming;
  const previous = parseRecord(left);
  if (previous.key !== incoming.key || previous.kind !== incoming.kind) throw new SyncDataError('record_key_mismatch');
  const order = compareStamp(previous.stamp, incoming.stamp);
  const tieLeft = previous.kind === 'track' ? previous.positionMs : canonical(previous.value);
  const tieRight = incoming.kind === 'track' ? incoming.positionMs : canonical(incoming.value);
  const winner = order > 0 || (order === 0 && tieLeft > tieRight) ? previous : incoming;
  if (winner.kind === 'setting') return winner;
  return {
    ...winner, completed: previous.completed || incoming.completed,
    furthestMs: Math.max(previous.furthestMs, incoming.furthestMs),
    durationMs: Math.max(previous.durationMs, incoming.durationMs)
  };
}
export async function trackKey(secret, rawId) {
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret) ||
      typeof rawId !== 'string' || !rawId || rawId.length > 512) throw new SyncDataError('invalid_track_identity');
  const bytes = Uint8Array.from(secret.match(/../g), part => Number.parseInt(part, 16));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawId));
  return 'track:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
