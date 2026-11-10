import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { parseOperation, parseRecord, mergeRecord, trackKey, canonical } from '../sync-model.js';
const actor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const key = 'track:' + 'a'.repeat(64);
const track = (counter, positionMs, extra = {}) => ({
  kind: 'track', key, stamp: { origin: 'live', counter, actor, sample: 0 },
  positionMs, furthestMs: positionMs, durationMs: 100000, completed: false, ...extra
});
const old = track(1, 80000, { completed: true });
const replay = track(2, 10000);
assert.deepEqual(mergeRecord(old, replay), { ...replay, furthestMs: 80000, completed: true });
console.log('PASS newer replay moves resume backward without losing completion');
const legacy = track(999, 99000, { stamp: { origin: 'legacy', counter: 999, actor, sample: 999 } });
assert.equal(mergeRecord(replay, legacy).positionMs, 10000);
assert.equal(mergeRecord(replay, legacy).furthestMs, 99000);
console.log('PASS old migration cannot replace live resume but preserves furthest');
const delayed = track(1, 90000, { stamp: { origin: 'live', counter: 1, actor, sample: 100 } });
assert.equal(mergeRecord(replay, delayed).positionMs, 10000);
console.log('PASS delayed samples cannot promote an older action');
const concurrent = track(2, 30000, { stamp: { origin: 'live', counter: 2, actor: other, sample: 0 } });
assert.deepEqual(mergeRecord(replay, concurrent), mergeRecord(concurrent, replay));
assert.equal(mergeRecord(replay, concurrent).positionMs, 30000);
assert.deepEqual(mergeRecord(replay, replay), replay);
console.log('PASS concurrent device actions converge and repeated merges are idempotent');
for (const bad of [
  { ...replay, title: 'private title' }, { ...replay, key: 'private-raw-id' },
  { ...replay, positionMs: NaN }, { ...replay, durationMs: -1 },
  { ...replay, stamp: { ...replay.stamp, counter: Number.MAX_SAFE_INTEGER + 1 } },
  { kind: 'setting', key: 'speed', stamp: replay.stamp, value: 9 }
]) assert.throws(() => parseRecord(bad));
assert.throws(() => parseOperation({ schema: 1, opId: actor, actor: other, record: replay }));
console.log('PASS private metadata, malformed records and mismatched actors rejected');
const secret = '42'.repeat(32), rawId = 'private-recording-example';
const expected = 'track:' + createHmac('sha256', Buffer.from(secret, 'hex')).update(rawId).digest('hex');
assert.equal(await trackKey(secret, rawId), expected);
assert.notEqual(await trackKey('43'.repeat(32), rawId), expected);
assert.equal(canonical({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
console.log('PASS opaque track identity matches independent HMAC implementation');
