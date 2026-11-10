import { compareStamp, MAX_BATCH, mergeRecord, parseRecord, trackKey } from './sync-model.js';
import { createSyncStore } from './sync-store.js';
import { createSyncTransport, SyncTransportError } from './sync-transport.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
  Number.isSafeInteger(Math.round(value * 1000)) ? Math.round(value * 1000) : null;
function next(counter = 0) {
  if (!integer(counter) || counter === Number.MAX_SAFE_INTEGER) throw new Error('counter_exhausted');
  return counter + 1;
}
function merge(tx, record) {
  const value = mergeRecord(tx.get(`record:${record.key}`), record);
  tx.put(`record:${record.key}`, value);
  tx.put('counter', Math.max(tx.get('counter') || 0, record.stamp.counter));
  return value;
}
function enqueue(tx, record) {
  const operation = { schema: 1, opId: crypto.randomUUID(), actor: record.stamp.actor, record };
  merge(tx, record);
  tx.put(`outbox:${operation.opId}`, operation);
}
function stamp(tx, actor) {
  const counter = next(tx.get('counter'));
  tx.put('counter', counter);
  return { origin: 'live', counter, actor, sample: 0 };
}
function requireIdentity(tx, origin) {
  const identity = tx.get('identity');
  if (!identity || identity.origin !== origin) throw new Error('activation_required');
  return identity;
}

// readSettings maps a known opaque lastTrack to its local raw ID; unknown keys
// remain opaque. Track durations supplied by the catalog are seconds.
export function createListeningSync({ origin, legacyStorage = globalThis.localStorage, tracks = [], originalTrackId, onStatus } = {}) {
  const request = createSyncTransport(origin);
  const serviceOrigin = new URL(origin).origin;
  const store = createSyncStore();
  const catalog = new Map(tracks.map(track => [track.id, track.duration]));
  const keys = new Map(), rawIds = new Map(), subscribers = new Set();
  let mappedSecret, channel, timer, running = false, inFlight, failures = 0, nextAttempt = 0;
  let actionTail = Promise.resolve();
  let status = { state: 'inactive', pending: 0 };

  async function identity() { return store.transaction(tx => tx.get('identity'), 'readonly'); }
  async function resolveKey(rawId, info = null) {
    if (typeof rawId !== 'string' || !rawId || rawId.length > 512) throw new Error('invalid_track_identity');
    info ||= await identity();
    if (!info || info.origin !== serviceOrigin) throw new Error('activation_required');
    if (mappedSecret !== info.trackKeySecret) { keys.clear(); rawIds.clear(); mappedSecret = info.trackKeySecret; }
    if (!keys.has(rawId)) {
      const key = await trackKey(info.trackKeySecret, rawId);
      keys.set(rawId, key); rawIds.set(key, rawId);
    }
    return keys.get(rawId);
  }
  async function mapCatalog(info) {
    for (const id of catalog.keys()) await resolveKey(id, info);
  }
  async function report(state, detail) {
    const pending = await store.transaction(tx => tx.values('outbox:').length, 'readonly');
    status = { state, pending, ...(detail ? { detail } : {}) };
    onStatus?.({ ...status });
    return { ...status };
  }
  function notify(broadcast = true) {
    if (broadcast) channel?.postMessage('changed');
    for (const callback of subscribers) {
      try { callback(); } catch (error) { console.error('Listening sync subscriber failed', error); }
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    timer = setTimeout(() => { void flush(); }, Math.max(15000, nextAttempt - Date.now()));
  }
  async function bootstrap(credential) {
    const data = await request('/api/device/bootstrap', credential.token);
    if (data.schema !== 1 || !uuid.test(data.actorId) || !uuid.test(data.sourceId) ||
        typeof data.trackKeySecret !== 'string' || !/^[0-9a-f]{64}$/.test(data.trackKeySecret)) throw new SyncTransportError('invalid_bootstrap');
    await store.transaction(tx => {
      const previous = tx.get('identity');
      if (previous && (previous.origin !== serviceOrigin || previous.sourceId !== data.sourceId ||
          previous.trackKeySecret !== data.trackKeySecret || previous.actorId !== data.actorId)) throw new SyncTransportError('source_conflict', 409);
      if (tx.get('credential')?.token !== credential.token) throw new Error('credential_changed');
      tx.put('identity', { ...data, origin: serviceOrigin });
      tx.put('credential', { origin: serviceOrigin, token: credential.token, tokenHash: credential.tokenHash });
      tx.delete('blocked');
    });
    await mapCatalog({ ...data, origin: serviceOrigin });
    return data;
  }
  async function authorize(credential) {
    try { return await bootstrap(credential); }
    catch (error) {
      if (error.status !== 401 || !credential.activationSecret) throw error;
      await request('/api/device/activate', credential.previousToken || null, {
        schema: 1, activationSecret: credential.activationSecret, tokenHash: credential.tokenHash
      });
      return bootstrap(credential);
    }
  }
  async function activate(secret) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return report('invalid_activation_secret');
    const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const tokenHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
    const blocked = await store.transaction(tx => {
      const old = tx.get('credential');
      if (old && old.origin !== serviceOrigin) return 'sync_origin_mismatch';
      // Rotate only a clean revoked credential. Retrying a pending activation
      // must retain its new bearer and original previous bearer for idempotency.
      const rotate = old && !old.activationSecret && tx.get('blocked') === 'authorization_required';
      tx.put('credential', { origin: serviceOrigin,
        token: rotate ? token : old?.token || token,
        tokenHash: rotate ? tokenHash : old?.tokenHash || tokenHash,
        ...(rotate ? { previousToken: old.token } : old?.previousToken ? { previousToken: old.previousToken } : {}),
        activationSecret: secret });
      tx.delete('blocked');
      return null;
    });
    if (blocked) return report(blocked);
    failures = 0; nextAttempt = 0;
    return flush();
  }
  async function pull(credential, info) {
    const knownCursor = await store.transaction(tx => tx.get('cursor') || 0, 'readonly');
    // Establish a fresh fixed watermark at cursor zero. Subsequent requests
    // may skip already committed pages, but must carry through and source.
    let cursor = 0;
    let watermark;
    for (let pages = 0; pages < 10000; pages++) {
      const query = new URLSearchParams({ cursor: String(cursor) });
      if (watermark !== undefined) { query.set('through', String(watermark)); query.set('source', info.sourceId); }
      const data = await request(`/api/sync/pull?${query}`, credential.token);
      if (data.sourceId !== info.sourceId) throw new SyncTransportError('source_conflict', 409);
      if (data.schema !== 1 || !integer(data.watermark) || data.watermark < cursor ||
          (watermark !== undefined && data.watermark !== watermark) ||
          !integer(data.nextCursor) || data.nextCursor < cursor || data.nextCursor > data.watermark ||
          typeof data.more !== 'boolean' || !Array.isArray(data.records) || data.records.length > MAX_BATCH ||
          (data.more && data.nextCursor === cursor) || (!data.more && data.nextCursor !== data.watermark)) {
        throw new SyncTransportError('invalid_pull');
      }
      let previous = cursor;
      const records = data.records.map(entry => {
        if (!integer(entry.seq) || entry.seq <= previous || entry.seq > data.nextCursor) throw new SyncTransportError('invalid_pull');
        previous = entry.seq;
        return parseRecord(entry.record);
      });
      await store.transaction(tx => {
        requireIdentity(tx, serviceOrigin);
        for (const record of records) merge(tx, record);
        // Another tab may already have completed a newer pull.
        tx.put('cursor', Math.max(tx.get('cursor') || 0, data.nextCursor));
      });
      if (records.length) notify();
      cursor = Math.max(data.nextCursor, Math.min(knownCursor, data.watermark)); watermark = data.watermark;
      if (!data.more || cursor === watermark) return;
    }
    throw new SyncTransportError('pull_page_limit');
  }
  async function push(credential, info) {
    // Bound one flush so continual playback cannot keep it open indefinitely.
    const queued = await store.transaction(tx => tx.values('outbox:'), 'readonly');
    for (let offset = 0; offset < queued.length; offset += MAX_BATCH) {
      const operations = queued.slice(offset, offset + MAX_BATCH);
      const data = await request('/api/sync/push', credential.token, { schema: 1, sourceId: info.sourceId, operations });
      if (data.sourceId !== info.sourceId) throw new SyncTransportError('source_conflict', 409);
      const sent = new Set(operations.map(operation => operation.opId));
      if (data.schema !== 1 || !Array.isArray(data.acknowledged) ||
          data.acknowledged.some(id => !sent.has(id)) || new Set(data.acknowledged).size !== data.acknowledged.length) {
        throw new SyncTransportError('invalid_acknowledgment');
      }
      await store.transaction(tx => {
        for (const id of data.acknowledged) tx.delete(`outbox:${id}`);
      });
    }
  }
  async function flush() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const saved = await store.transaction(tx => ({ credential: tx.get('credential'), blocked: tx.get('blocked') }), 'readonly');
        if (!saved.credential) return report('activation_required');
        if (saved.credential.origin !== serviceOrigin) return report('sync_origin_mismatch');
        if (saved.blocked) return report(saved.blocked);
        if (Date.now() < nextAttempt) return report('backoff');
        const info = await authorize(saved.credential);
        const credential = await store.transaction(tx => tx.get('credential'), 'readonly');
        await pull(credential, info);
        await migrate();
        await push(credential, info);
        failures = 0; nextAttempt = 0;
        notify();
        return report('synced');
      } catch (error) {
        if (error.status === 401 || error.status === 409) {
          const state = error.status === 401 ? 'authorization_required' : 'source_conflict';
          await store.transaction(tx => tx.put('blocked', state));
          notify();
          return report(state);
        }
        failures++;
        nextAttempt = Date.now() + Math.min(300000, 1000 * 2 ** Math.min(failures, 8));
        return report(error.code || 'storage_error', error.code || error.name);
      } finally { inFlight = null; schedule(); }
    })();
    return inFlight;
  }
  async function migrate() {
    const info = await identity();
    if (!info || info.origin !== serviceOrigin) return { migrated: false, reason: 'activation_required' };
    const already = await store.transaction(tx => tx.get('migrated'), 'readonly');
    if (already) return { migrated: false, reason: 'already_migrated' };
    const ids = new Set(catalog.keys());
    const records = [];
    if (legacyStorage) {
      for (let i = 0; i < legacyStorage.length; i++) {
        const key = legacyStorage.key(i);
        if (key?.startsWith('mw_pos_')) ids.add(key.slice(7));
        if (key?.startsWith('mw_progress_')) ids.add(key.slice(12));
      }
      if (originalTrackId) ids.add(originalTrackId);
      const legacyStamp = { origin: 'legacy', counter: 0, actor: info.actorId, sample: 0 };
      for (const id of ids) {
        if (!id || id.length > 512) continue;
        const raw = legacyStorage.getItem(`mw_pos_${id}`) ??
          (id === originalTrackId ? legacyStorage.getItem('mw_pos') : null);
        const position = raw !== null && raw.trim() !== '' ? seconds(Number(raw)) : null;
        let progress;
        try {
          const value = JSON.parse(legacyStorage.getItem(`mw_progress_${id}`) || 'null');
          if (value && !Array.isArray(value) && typeof value === 'object' &&
              typeof value.completed === 'boolean' && seconds(value.furthest) !== null && seconds(value.duration) !== null) progress = value;
        } catch { /* Malformed legacy entries remain untouched and local. */ }
        if (position === null && !progress) continue;
        const furthestMs = Math.max(position || 0, progress ? seconds(progress.furthest) : 0);
        if (furthestMs === 0 && !progress?.completed) continue;
        records.push({ kind: 'track', key: await resolveKey(id, info), stamp: legacyStamp,
          positionMs: position || 0, furthestMs,
          durationMs: progress ? seconds(progress.duration) : 0, completed: progress?.completed || false });
      }
      const speedRaw = legacyStorage.getItem('mw_speed');
      const speed = Number(speedRaw);
      if (speedRaw && [0.8, 1, 1.25, 1.5, 2].includes(speed)) records.push({ kind: 'setting', key: 'speed', stamp: legacyStamp, value: speed });
      const loop = legacyStorage.getItem('mw_loop');
      if (['normal', 'one'].includes(loop)) records.push({ kind: 'setting', key: 'loop', stamp: legacyStamp, value: loop });
      const lastTrack = legacyStorage.getItem('mw_lastTrack');
      if (lastTrack && lastTrack.length <= 512) {
        const key = await resolveKey(lastTrack, info);
        if (lastTrack !== originalTrackId || records.some(record => record.kind === 'track' && record.key === key)) {
          records.push({ kind: 'setting', key: 'lastTrack', stamp: legacyStamp, value: key });
        }
      }
    }
    const count = await store.transaction(tx => {
      requireIdentity(tx, serviceOrigin);
      if (tx.get('migrated')) return 0;
      for (const record of records) enqueue(tx, parseRecord(record));
      tx.put('migrated', true);
      return records.length;
    });
    if (count) notify();
    return { migrated: true, count };
  }
  function beginAction(input) {
    // Reserve invocation order before HMAC awaits can reorder rapid clicks.
    const pending = actionTail.then(() => createAction(input));
    actionTail = pending.catch(() => {});
    return pending;
  }
  async function createAction({ trackId, kind }) {
    if (!['play', 'seek', 'select'].includes(kind)) throw new Error('invalid_action_kind');
    const key = await resolveKey(trackId);
    const action = await store.transaction(tx => {
      const info = requireIdentity(tx, serviceOrigin);
      const value = { ...stamp(tx, info.actorId), trackKey: key, kind };
      tx.put('action', value);
      if (kind === 'select' || kind === 'play') enqueue(tx, { kind: 'setting', key: 'lastTrack', stamp: {
        origin: value.origin, actor: value.actor, counter: value.counter, sample: 0
      }, value: key });
      return value;
    });
    if (kind === 'select' || kind === 'play') notify();
    return action;
  }
  async function observe({ trackId, action, positionMs, durationMs = 0, ended = false }) {
    if (!action) return { accepted: false, reason: 'no_action' };
    if (!integer(positionMs) || !integer(durationMs) || typeof ended !== 'boolean') throw new Error('invalid_observation');
    const key = await resolveKey(trackId);
    const result = await store.transaction(tx => {
      requireIdentity(tx, serviceOrigin);
      const current = tx.get('action'), previous = tx.get(`record:${key}`);
      if (!current || current.trackKey !== key || action.trackKey !== key || current.counter !== action.counter ||
          current.actor !== action.actor || (previous && compareStamp(previous.stamp, { ...current, sample: Number.MAX_SAFE_INTEGER }) > 0)) {
        return { accepted: false, reason: 'stale_action' };
      }
      const content = { positionMs, durationMs: Math.max(durationMs, previous?.durationMs || 0),
        furthestMs: Math.max(positionMs, ended ? durationMs : 0, previous?.furthestMs || 0), completed: ended || previous?.completed || false };
      if (previous && Object.keys(content).every(field => content[field] === previous[field])) return { accepted: false, reason: 'unchanged' };
      current.sample = next(current.sample);
      tx.put('action', current);
      enqueue(tx, parseRecord({ kind: 'track', key, stamp: { origin: 'live', counter: current.counter, actor: current.actor, sample: current.sample }, ...content }));
      return { accepted: true };
    });
    if (result.accepted) notify();
    return result;
  }
  async function setPreference({ key, value }) {
    if (key === 'lastTrack') value = await resolveKey(value);
    if (!['speed', 'loop', 'lastTrack'].includes(key)) throw new Error('invalid_setting');
    const result = await store.transaction(tx => {
      const info = requireIdentity(tx, serviceOrigin);
      const record = parseRecord({ kind: 'setting', key, value, stamp: stamp(tx, info.actorId) });
      enqueue(tx, record);
      return record;
    });
    notify();
    return result;
  }
  async function readTrack(trackId) {
    const info = await identity();
    if (!info || info.origin !== serviceOrigin) return null;
    const key = await resolveKey(trackId, info);
    return store.transaction(tx => tx.get(`record:${key}`) || null, 'readonly');
  }
  async function readSettings() {
    const info = await identity();
    if (!info || info.origin !== serviceOrigin) return {};
    await mapCatalog(info);
    return store.transaction(tx => Object.fromEntries(['speed', 'loop', 'lastTrack'].flatMap(key => {
      const record = tx.get(`record:${key}`);
      return record ? [[key, key === 'lastTrack' ? rawIds.get(record.value) || record.value : record.value]] : [];
    })), 'readonly');
  }
  async function registerTracks(additions) {
    for (const { id, duration = 0 } of additions) {
      if (typeof id !== 'string' || !id || id.length > 512 || seconds(duration) === null) throw new Error('invalid_track_identity');
    }
    const info = await identity();
    for (const { id, duration = 0 } of additions) {
      catalog.set(id, duration);
      if (info?.origin === serviceOrigin) await resolveKey(id, info);
    }
    return { registered: additions.length };
  }
  const onOnline = () => { void flush(); };
  const onVisibility = () => { if (globalThis.document?.visibilityState === 'visible') void flush(); };
  async function start() {
    if (!running) {
      running = true;
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('MindWalkmanSync');
        channel.onmessage = () => notify(false);
      }
      globalThis.addEventListener?.('online', onOnline);
      globalThis.document?.addEventListener('visibilitychange', onVisibility);
    }
    return flush();
  }
  async function stop() {
    running = false;
    clearTimeout(timer);
    globalThis.removeEventListener?.('online', onOnline);
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    channel?.close(); channel = null;
    // Let a committed in-flight sync finish before closing its database handle.
    if (inFlight) await inFlight;
    await store.close();
  }
  return { activate, start, stop, flush, migrate, beginAction, observe, setPreference, readTrack, readSettings, registerTracks,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); } };
}
