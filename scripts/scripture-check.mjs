import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const context = vm.createContext({});
const data = await fs.readFile('course-data.js', 'utf8');
vm.runInContext(data + ';globalThis.items=[COURSE_TOPIC,HOPE_TOPIC,BIBLE_TOPIC,DIAMOND_TOPIC];', context);
const topics = JSON.parse(JSON.stringify(context.items));
const baseline = vm.createContext({});
vm.runInContext(execFileSync('git', ['show', 'd9fac1ce2a22815c2e45acab22478741e1edf922:course-data.js'], { encoding: 'utf8' }) + ';globalThis.items=[COURSE_TOPIC,HOPE_TOPIC];', baseline);
assert.deepEqual(topics.slice(0, 2), JSON.parse(JSON.stringify(baseline.items)), 'Existing 107 and Hope metadata changed');
const manifest = JSON.parse(await fs.readFile('docs/acceptance.json', 'utf8'));
const published = JSON.parse(execFileSync('git', ['show', '262713766a2c410f455ca025df042e781e34dbe9:docs/acceptance.json'], { encoding: 'utf8' }));
assert.equal(published.required.length, 21);
const publishedIds = new Set(published.required.map(r => r.id));
const manifestSubset = manifest.required.filter(r => publishedIds.has(r.id));
assert.deepEqual(manifestSubset, published.required, 'Published 21 gates must remain unchanged');
const media = JSON.parse(await fs.readFile('docs/qa/scripture-1109/media-final-receipt.json', 'utf8'));
assert.equal(media.files.length, 12);
assert.deepEqual(topics.slice(2).map(topic => topic.tracks.length), [3, 9]);
assert.deepEqual(topics[2].tracks.map(track => track.fileName), ['mw230903.mp3', 'mw200810.mp3', 'mw200614.mp3']);
assert.equal(new Set(topics.flatMap(topic => topic.tracks.map(track => track.id))).size, 120);
for (const topic of topics.slice(2)) {
  assert.ok(topic.backupFolder);
  for (const track of topic.tracks) {
    const row = media.files.find(file => './' + file.path === track.audioSrc);
    assert.ok(row, `Missing independently measured media ${track.id}`);
    const bytes = await fs.readFile(track.audioSrc);
    assert.equal(bytes.length, row.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, `Private media SHA mismatch ${track.id}`);
    assert.equal(track.bytes, row.bytes);
    assert.equal(track.sha256, row.sha256);
    assert.equal(track.duration, row.durationSeconds);
    assert.equal(row.fullDecodeExitCode, 0);
    assert.equal(track.privateAudio, true);
    assert.equal(track.mime, 'audio/mpeg');
    assert.equal(track.fileName, row.path.split('/').at(-1));
    console.log(`PASS ${track.id} ${track.bytes} bytes duration=${track.duration} sha256=${track.sha256}`);
  }
}
console.log('PASS published 21 gates, 107 course tracks and Hope metadata preserved');
