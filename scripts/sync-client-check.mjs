// Native IndexedDB + owned Chromium. The wire fixture deliberately injects
// failures; it is not a replacement for the service's PostgreSQL acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mergeRecord, parseOperation, trackKey } from '../sync-model.js';

const driver = process.env.OMOWRIGHT_DRIVER ||
  '/Users/chuangwen/.codex/plugins/cache/sisyphuslabs/omo/5.1.65/skills/browser/scripts/omowright.mjs';
const { loadOmowright } = await import(driver);
const { omowright } = await loadOmowright();
const root = await fs.mkdtemp(path.join(tmpdir(), 'mind-walkman-sync-'));
const profile = path.join(root, 'browser');
const secret = '47'.repeat(32), rotationSecret = '48'.repeat(32), keySecret = 'a3'.repeat(32);
const originalId = 'fixture-original', privateId = 'fixture-private-recording';
const otherId = 'fixture-second', unknownId = 'fixture-not-in-catalog';
const actor = randomUUID(), remoteActor = randomUUID();
let source = randomUUID(), seq = 0, offline = false, dropActivation = true, revoked = false;
let oversized = false, invalidAck = false, holdPush, currentTokenHash, dropRotation = true;
const grants = new Map(), records = new Map(), versions = [], seen = new Map(), requests = [];
function save(record) {
  const merged = mergeRecord(records.get(record.key), record);
  records.set(record.key, merged);
  versions.push({ seq: ++seq, record: merged });
}
const privateKey = await trackKey(keySecret, privateId);
save({ kind: 'track', key: privateKey, stamp: { origin: 'live', counter: 20, actor: remoteActor, sample: 0 },
  positionMs: 5000, furthestMs: 5000, durationMs: 100000, completed: false });
const hash = token => createHash('sha256').update(token).digest('hex');
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') return void response.end('<!doctype html><title>Sync regression</title><body>Isolated listening sync regression</body>');
    if (/^\/sync-(client|model|store|transport)\.js$/.test(url.pathname)) {
      response.setHeader('Content-Type', 'text/javascript');
      return void response.end(await fs.readFile(path.resolve(url.pathname.slice(1))));
    }
    if (!url.pathname.startsWith('/api/')) return json(response, {}, 404);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    const body = text ? JSON.parse(text) : null;
    requests.push({ path: request.url, body, hasAuthorization: !!request.headers.authorization });
    if (offline) return void request.socket.destroy();
    if (url.pathname === '/api/device/activate') {
      assert.ok([secret, rotationSecret].includes(body.activationSecret));
      const previous = grants.get(body.activationSecret);
      if (previous && previous !== body.tokenHash) return json(response, {}, 409);
      const rotating = body.activationSecret === rotationSecret;
      if (rotating && !previous) {
        const oldToken = request.headers.authorization?.replace(/^Bearer /, '');
        assert.equal(hash(oldToken), currentTokenHash);
        assert.notEqual(body.tokenHash, currentTokenHash);
        revoked = false;
      } else if (!rotating) assert.equal(request.headers.authorization, undefined);
      grants.set(body.activationSecret, body.tokenHash);
      currentTokenHash = body.tokenHash;
      if (dropActivation || (rotating && dropRotation)) {
        if (rotating) dropRotation = false;
        else dropActivation = false;
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '64' });
        return void response.end('{"activated":');
      }
      return json(response, { activated: true });
    }
    const token = request.headers.authorization?.replace(/^Bearer /, '') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || revoked || currentTokenHash !== hash(token)) return json(response, {}, 401);
    if (url.pathname === '/api/device/bootstrap') return json(response, {
      schema: 1, actorId: actor, sourceId: source, trackKeySecret: keySecret
    });
    if (url.pathname === '/api/sync/pull') {
      if (oversized) return void response.end(' '.repeat(256 * 1024 + 1));
      const cursor = Number(url.searchParams.get('cursor') || 0);
      const through = Number(url.searchParams.get('through') || seq);
      if (cursor > 0 && (!url.searchParams.has('through') || url.searchParams.get('source') !== source)) return json(response, {}, 409);
      const page = versions.filter(entry => entry.seq > cursor && entry.seq <= through).slice(0, 100);
      const nextCursor = page.length === 100 && page.at(-1).seq < through ? page.at(-1).seq : through;
      return json(response, { schema: 1, sourceId: source, watermark: through, nextCursor,
        more: nextCursor < through, records: page });
    }
    if (url.pathname === '/api/sync/push') {
      if (holdPush) await holdPush;
      assert.equal(body.sourceId, source);
      const acknowledged = [];
      for (const value of body.operations) {
        const operation = parseOperation(value);
        assert.equal(operation.actor, actor);
        if (!seen.has(operation.opId)) { save(operation.record); seen.set(operation.opId, JSON.stringify(operation)); }
        else assert.equal(seen.get(operation.opId), JSON.stringify(operation));
        acknowledged.push(operation.opId);
      }
      return json(response, { schema: 1, sourceId: source, acknowledged: invalidAck ? [randomUUID()] : acknowledged });
    }
    return json(response, {}, 404);
  } catch (error) {
    console.error(error);
    json(response, { error: 'fixture_failure' }, 500);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page, staleAction;
const results = [];
async function open(profileDirectory = profile) {
  browser = await omowright.connectPipe({
    browserPath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    browserArgs: ['--headless', '--no-first-run', `--user-data-dir=${profileDirectory}`], storageRoot: profileDirectory
  });
  page = await browser.newTab(origin);
  await page.evaluate(async () => {
    const { createListeningSync } = await import('/sync-client.js');
    window.makeSync = origin => createListeningSync({
      origin: origin || location.origin, legacyStorage: localStorage,
      tracks: [{ id: 'fixture-original', duration: 200 }, { id: 'fixture-private-recording', duration: 100 },
        { id: 'fixture-second', duration: 100 }], originalTrackId: 'fixture-original',
      onStatus: value => { window.syncStatus = value; }
    });
    window.sync = makeSync();
    window.advanceRetry = () => { const now = Date.now(); Date.now = () => now + 301000; };
  });
}
async function check(name, run) {
  const detail = await run();
  results.push({ name, detail });
  console.log(`PASS ${name}: ${JSON.stringify(detail)}`);
}
try {
  await open();
  await check('preactivation never contacts service or invents local state', async () => {
    const value = await page.evaluate(async () => ({
      status: await sync.start(), invalid: await sync.activate('bad-secret'),
      track: await sync.readTrack('fixture-original'), settings: await sync.readSettings()
    }));
    assert.equal(value.status.state, 'activation_required');
    assert.equal(value.invalid.state, 'invalid_activation_secret');
    assert.equal(value.track, null); assert.deepEqual(value.settings, {}); assert.equal(requests.length, 0);
    return value.status;
  });
  await check('activation lost response keeps durable bearer for bootstrap recovery', async () => {
    await page.evaluate(() => {
      localStorage.setItem('mw_pos', '45');
      localStorage.setItem('mw_pos_fixture-private-recording', '10');
      localStorage.setItem('mw_progress_fixture-private-recording', JSON.stringify({ completed: true, furthest: 90, duration: 100 }));
      localStorage.setItem('mw_pos_fixture-not-in-catalog', '12');
      localStorage.setItem('mw_pos_fixture-corrupt', 'not-a-number');
      localStorage.setItem('mw_progress_fixture-corrupt', '{broken');
      localStorage.setItem('mw_speed', '1.5');
      localStorage.setItem('mw_loop', 'one');
      localStorage.setItem('mw_lastTrack', 'fixture-private-recording');
    });
    const value = await page.evaluate(async () => sync.activate('47'.repeat(32)));
    assert.equal(value.state, 'network_unavailable');
    await browser.close(); browser = null;
    await open();
    const recovered = await page.evaluate(async () => sync.start());
    assert.equal(recovered.state, 'synced');
    assert.equal(requests.filter(entry => entry.path === '/api/device/activate').length, 1);
    return { initial: value.state, recovered: recovered.state, activationRequests: 1 };
  });
  await check('migration preserves originals, completion, unknown IDs, and live priority', async () => {
    const value = await page.evaluate(async () => ({
      track: await sync.readTrack('fixture-private-recording'),
      original: await sync.readTrack('fixture-original'),
      other: await sync.readTrack('fixture-second'),
      unknown: await sync.readTrack('fixture-not-in-catalog'),
      corrupt: await sync.readTrack('fixture-corrupt'),
      settings: await sync.readSettings(),
      legacy: localStorage.getItem('mw_pos'), bad: localStorage.getItem('mw_progress_fixture-corrupt'),
      again: await sync.migrate()
    }));
    assert.equal(value.track.positionMs, 5000); assert.equal(value.track.furthestMs, 90000);
    assert.equal(value.track.completed, true); assert.equal(value.original.positionMs, 45000);
    assert.equal(value.other, null); assert.equal(value.unknown.positionMs, 12000); assert.equal(value.corrupt, null);
    assert.deepEqual(value.settings, { speed: 1.5, loop: 'one', lastTrack: privateId });
    assert.equal(value.legacy, '45'); assert.equal(value.bad, '{broken'); assert.equal(value.again.reason, 'already_migrated');
    return { resume: value.track.positionMs, completed: value.track.completed, unknown: value.unknown.positionMs };
  });
  await check('idle observations do not echo and latest explicit action wins', async () => {
    const value = await page.evaluate(async () => {
      const idle = await sync.observe({ trackId: 'fixture-private-recording', positionMs: 90000 });
      const [old, latest] = await Promise.all([
        sync.beginAction({ trackId: 'fixture-second', kind: 'play' }),
        sync.beginAction({ trackId: 'fixture-private-recording', kind: 'seek' })
      ]);
      const stale = await sync.observe({ trackId: 'fixture-second', action: old, positionMs: 12000 });
      const observed = await sync.observe({ trackId: 'fixture-private-recording', action: latest, positionMs: 20000, durationMs: 100000 });
      const duplicate = await sync.observe({ trackId: 'fixture-private-recording', action: latest, positionMs: 20000, durationMs: 100000 });
      window.oldAction = latest;
      return { idle, stale, observed, duplicate, action: latest, track: await sync.readTrack('fixture-private-recording') };
    });
    assert.equal(value.idle.reason, 'no_action'); assert.equal(value.stale.reason, 'stale_action');
    assert.equal(value.observed.accepted, true); assert.equal(value.duplicate.reason, 'unchanged');
    assert.equal(value.track.completed, true); assert.equal(value.track.positionMs, 20000);
    staleAction = value.action;
    return { idle: value.idle.reason, stale: value.stale.reason, duplicate: value.duplicate.reason };
  });
  await check('offline queue and bookmark survive a full browser reopen', async () => {
    offline = true;
    const value = await page.evaluate(async () => {
      await sync.setPreference({ key: 'speed', value: 2 });
      return sync.flush();
    });
    // The explicit play also queued its lastTrack register before going offline.
    assert.equal(value.state, 'network_unavailable'); assert.equal(value.pending, 3);
    await browser.close(); browser = null;
    await open();
    const reopened = await page.evaluate(async () => ({
      status: await sync.start(), track: await sync.readTrack('fixture-private-recording'), settings: await sync.readSettings()
    }));
    assert.equal(reopened.status.pending, 3); assert.equal(reopened.track.positionMs, 20000);
    assert.equal(reopened.settings.speed, 2);
    assert.equal(reopened.settings.lastTrack, 'fixture-second');
    return { pending: reopened.status.pending, positionMs: reopened.track.positionMs };
  });
  await check('pull merges remote before queued local push and stale playback cannot reclaim', async () => {
    save({ kind: 'track', key: privateKey, stamp: { origin: 'live', counter: 50, actor: remoteActor, sample: 0 },
      positionMs: 7000, furthestMs: 95000, durationMs: 100000, completed: false });
    offline = false;
    const value = await page.evaluate(async action => {
      advanceRetry();
      const status = await sync.flush();
      const stale = await sync.observe({ trackId: 'fixture-private-recording', action, positionMs: 25000 });
      return { status, stale, track: await sync.readTrack('fixture-private-recording') };
    }, staleAction);
    assert.equal(value.status.state, 'synced'); assert.equal(value.status.pending, 0);
    assert.equal(value.track.positionMs, 7000); assert.equal(value.track.furthestMs, 95000);
    assert.equal(value.track.completed, true); assert.equal(records.get(privateKey).positionMs, 7000);
    assert.equal(value.stale.reason, 'stale_action');
    return { state: value.status.state, positionMs: value.track.positionMs, completed: value.track.completed };
  });
  await check('native transactions serialize two tabs and preserve all queued operations', async () => {
    const tab = await browser.newTab(origin);
    await tab.evaluate(async () => {
      const { createListeningSync } = await import('/sync-client.js');
      window.sync = createListeningSync({ origin: location.origin, legacyStorage: localStorage });
      await sync.start();
      window.changed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('cross_tab_notification_missing')), 5000);
        const unsubscribe = sync.subscribe(() => { clearTimeout(timeout); unsubscribe(); resolve(true); });
      });
    });
    await page.evaluate(async () => sync.setPreference({ key: 'loop', value: 'normal' }));
    assert.equal(await tab.evaluate(async () => changed), true);
    const values = await Promise.all([page, tab].map((target, index) => target.evaluate(async count => {
      const values = [];
      for (let i = 0; i < 12; i++) values.push((await sync.setPreference({ key: 'speed', value: count ? 1.25 : 1.5 })).stamp.counter);
      return values;
    }, index)));
    assert.equal(new Set(values.flat()).size, 24);
    const value = await page.evaluate(async () => sync.flush());
    assert.equal(value.state, 'synced'); assert.equal(value.pending, 0);
    assert.equal(seen.size, 34); // Includes the explicit play's lastTrack operation.
    await tab.evaluate(async () => sync.stop());
    return { uniqueCounters: 24, crossTabNotification: true, acknowledgedOperations: seen.size };
  });
  await check('acknowledgment removes only the sent snapshot while a new action is queued', async () => {
    await page.evaluate(async () => sync.setPreference({ key: 'loop', value: 'one' }));
    let release;
    holdPush = new Promise(resolve => { release = resolve; });
    let observePush;
    const requestSeen = new Promise(resolve => { observePush = resolve; });
    const listener = request => { if (request.url === '/api/sync/push') observePush(); };
    server.on('request', listener);
    const flushing = page.evaluate(async () => sync.flush());
    await requestSeen;
    await page.evaluate(async () => sync.setPreference({ key: 'speed', value: 0.8 }));
    release(); holdPush = null; server.off('request', listener);
    const value = await flushing;
    assert.equal(value.pending, 1);
    const final = await page.evaluate(async () => sync.flush());
    assert.equal(final.pending, 0);
    return { pendingAfterSnapshotAck: value.pending, finalPending: final.pending };
  });
  await check('unrecognized acknowledgments never delete queued work', async () => {
    await page.evaluate(async () => sync.setPreference({ key: 'loop', value: 'normal' }));
    invalidAck = true;
    const value = await page.evaluate(async () => sync.flush());
    assert.equal(value.state, 'invalid_acknowledgment'); assert.equal(value.pending, 1);
    invalidAck = false;
    const recovered = await page.evaluate(async () => { advanceRetry(); return sync.flush(); });
    assert.equal(recovered.pending, 0);
    return { rejected: value.state, recovered: recovered.state };
  });
  await check('runtime imported tracks resolve privately and map lastTrack after registration', async () => {
    const value = await page.evaluate(async () => {
      await sync.registerTracks([{ id: 'fixture-runtime-import', duration: 80 }]);
      const action = await sync.beginAction({ trackId: 'fixture-runtime-import', kind: 'select' });
      await sync.observe({ trackId: 'fixture-runtime-import', action, positionMs: 9000, durationMs: 80000 });
      const status = await sync.flush();
      return { status, track: await sync.readTrack('fixture-runtime-import'), settings: await sync.readSettings() };
    });
    assert.equal(value.status.state, 'synced'); assert.equal(value.track.positionMs, 9000);
    assert.equal(value.settings.lastTrack, 'fixture-runtime-import');
    assert.equal(JSON.stringify(requests).includes('fixture-runtime-import'), false);
    return { positionMs: value.track.positionMs, lastTrack: value.settings.lastTrack };
  });
  await check('direct playback of a newly imported track updates lastTrack without a selection event', async () => {
    const value = await page.evaluate(async () => {
      const action = await sync.beginAction({ trackId: 'fixture-direct-play', kind: 'play' });
      await sync.observe({ trackId: 'fixture-direct-play', action, positionMs: 12000, durationMs: 80000 });
      await sync.flush();
      return { settings: await sync.readSettings(), track: await sync.readTrack('fixture-direct-play') };
    });
    assert.equal(value.settings.lastTrack, 'fixture-direct-play');
    assert.equal(value.track.positionMs, 12000);
    assert.equal(records.get('lastTrack').value, await trackKey(keySecret, 'fixture-direct-play'));
    assert.equal(JSON.stringify(requests).includes('fixture-direct-play'), false);
    return { lastTrack: value.settings.lastTrack, positionMs: value.track.positionMs };
  });
  await check('aborted outbox write rolls back record and sample in the same native transaction', async () => {
    const value = await page.evaluate(async () => {
      const action = await sync.beginAction({ trackId: 'fixture-runtime-import', kind: 'seek' });
      const before = await sync.readTrack('fixture-runtime-import');
      const originalPut = IDBObjectStore.prototype.put;
      let errorName;
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (value.key?.startsWith('outbox:')) throw new DOMException('Injected disk failure', 'QuotaExceededError');
        return originalPut.call(this, value, ...args);
      };
      try { await sync.observe({ trackId: 'fixture-runtime-import', action, positionMs: 48000 }); }
      catch (error) { errorName = error.name; }
      finally { IDBObjectStore.prototype.put = originalPut; }
      return { before, after: await sync.readTrack('fixture-runtime-import'), errorName, status: await sync.flush() };
    });
    assert.equal(value.errorName, 'QuotaExceededError'); assert.deepEqual(value.after, value.before);
    assert.equal(value.status.pending, 0);
    return { error: value.errorName, positionMs: value.after.positionMs, pending: value.status.pending };
  });
  await check('response size is bounded and retry backoff suppresses immediate fetches', async () => {
    oversized = true;
    const value = await page.evaluate(async () => sync.flush());
    assert.equal(value.state, 'response_too_large');
    const count = requests.length;
    const again = await page.evaluate(async () => sync.flush());
    assert.equal(again.state, 'backoff'); assert.equal(requests.length, count);
    oversized = false;
    await page.evaluate(async () => { advanceRetry(); return sync.flush(); });
    return { state: value.state, immediate: again.state };
  });
  await check('origin changes preserve local queue without sending bearer', async () => {
    const count = requests.length;
    const value = await page.evaluate(async () => {
      await sync.setPreference({ key: 'loop', value: 'one' });
      const wrong = makeSync(`http://localhost:${location.port}`);
      const status = await wrong.start();
      const activation = await wrong.activate('47'.repeat(32));
      await wrong.stop();
      return { status, activation };
    });
    assert.equal(value.status.state, 'sync_origin_mismatch'); assert.equal(value.status.pending, 1);
    assert.equal(value.activation.state, 'sync_origin_mismatch'); assert.equal(requests.length, count);
    return { state: value.status.state, pending: value.status.pending };
  });
  await check('changed source requires recovery and retains queue', async () => {
    const originalSource = source;
    source = randomUUID();
    const value = await page.evaluate(async () => sync.flush());
    assert.equal(value.state, 'source_conflict'); assert.equal(value.pending, 1);
    source = originalSource;
    const recovered = await page.evaluate(async () => sync.activate('47'.repeat(32)));
    assert.equal(recovered.state, 'synced'); assert.equal(recovered.pending, 0);
    return { state: value.state, pending: value.pending, originalSourceRecovered: recovered.state };
  });
  await check('revoked bearer stops repeated 401 requests across client instances', async () => {
    await page.evaluate(async () => sync.setPreference({ key: 'loop', value: 'normal' }));
    revoked = true;
    const value = await page.evaluate(async () => sync.flush());
    assert.equal(value.state, 'authorization_required'); assert.equal(value.pending, 1);
    const count = requests.length;
    const again = await page.evaluate(async () => {
      const duplicate = makeSync();
      const value = await duplicate.start();
      await duplicate.stop();
      return value;
    });
    assert.equal(again.state, 'authorization_required'); assert.equal(requests.length, count);
    return { state: value.state, duplicate: again.state, requestsAfterBlock: 0 };
  });
  await check('reauthorization rotates bearer under same actor and recovers lost response with queued writes', async () => {
    const oldHash = currentTokenHash;
    const value = await page.evaluate(async () => sync.activate('48'.repeat(32)));
    assert.equal(value.state, 'network_unavailable'); assert.equal(value.pending, 1);
    assert.notEqual(currentTokenHash, oldHash);
    await browser.close(); browser = null;
    await open();
    const recovered = await page.evaluate(async () => sync.start());
    assert.equal(recovered.state, 'synced'); assert.equal(recovered.pending, 0);
    const activationRequests = requests.filter(entry => entry.path === '/api/device/activate');
    assert.equal(activationRequests.length, 2);
    assert.equal(activationRequests[0].hasAuthorization, false);
    assert.equal(activationRequests[1].hasAuthorization, true);
    assert.ok([...seen.values()].map(JSON.parse).every(operation => operation.actor === actor));
    const clean = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('MindWalkmanSync', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        const entry = await new Promise((resolve, reject) => {
          const request = db.transaction('entries').objectStore('entries').get('credential');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        return !Object.hasOwn(entry.value, 'previousToken') && !Object.hasOwn(entry.value, 'activationSecret');
      } finally { db.close(); }
    });
    assert.equal(clean, true);
    return { initial: value.state, recovered: recovered.state, pending: recovered.pending, sameActor: true, pendingSecretsRemoved: clean };
  });
  await check('untouched legacy defaults cannot overwrite existing migrated progress or lastTrack', async () => {
    await browser.close(); browser = null;
    records.clear(); versions.length = 0; seen.clear(); grants.clear();
    currentTokenHash = undefined; seq = 0; source = randomUUID();
    const stamp = { origin: 'legacy', counter: 0, actor: '00000000-0000-0000-0000-000000000000', sample: 0 };
    const originalKey = await trackKey(keySecret, originalId);
    const otherKey = await trackKey(keySecret, otherId);
    save({ kind: 'track', key: originalKey, stamp, positionMs: 42000, furthestMs: 70000, durationMs: 200000, completed: false });
    save({ kind: 'setting', key: 'lastTrack', stamp, value: otherKey });
    await open(path.join(root, 'blank-migration'));
    const requestCount = requests.length;
    const value = await page.evaluate(async () => {
      localStorage.setItem('mw_pos', '0');
      localStorage.setItem('mw_pos_fixture-original', '0');
      localStorage.setItem('mw_progress_fixture-original', JSON.stringify({ completed: false, furthest: 0, duration: 200 }));
      localStorage.setItem('mw_progress_fixture-second', JSON.stringify({ completed: true, furthest: 0, duration: 100 }));
      localStorage.setItem('mw_lastTrack', 'fixture-original');
      const status = await sync.activate('47'.repeat(32));
      return { status, track: await sync.readTrack('fixture-original'), settings: await sync.readSettings(), legacy: localStorage.getItem('mw_pos') };
    });
    assert.equal(value.status.state, 'synced');
    assert.equal(value.track.positionMs, 42000);
    assert.equal(value.track.furthestMs, 70000);
    assert.equal(value.settings.lastTrack, otherId);
    assert.equal(value.legacy, '0');
    assert.equal(records.get(originalKey).positionMs, 42000);
    assert.equal(records.get('lastTrack').value, otherKey);
    assert.equal(records.get(otherKey).completed, true);
    const pushed = requests.slice(requestCount).filter(entry => entry.path === '/api/sync/push').flatMap(entry => entry.body.operations);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].record.key, otherKey);
    assert.equal(pushed[0].record.completed, true);
    return { positionMs: value.track.positionMs, lastTrack: value.settings.lastTrack, completedPreserved: true, pushed: pushed.length };
  });
  await check('wire operations contain no private raw IDs or metadata', async () => {
    const wire = JSON.stringify(requests);
    for (const rawId of [originalId, privateId, otherId, unknownId]) assert.equal(wire.includes(rawId), false);
    assert.equal(wire.includes('private title'), false);
    for (const request of requests.filter(entry => entry.path === '/api/sync/push')) {
      for (const operation of request.body.operations) parseOperation(operation);
    }
    return { inspectedRequests: requests.length, opaqueTrackKeysOnly: true };
  });
  console.log(`PASS sync client: ${results.length} native browser regression scenarios`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await fs.rm(root, { recursive: true, force: true });
}
