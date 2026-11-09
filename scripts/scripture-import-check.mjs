import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const { loadOmowright } = await import(process.env.OMOWRIGHT_DRIVER);
const { omowright } = await loadOmowright();
const output = '.omo/evidence/scripture';
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(tmpdir(), 'scripture-browser-'));
const profile = path.join(temporary, 'profile');
const origin = 'http://tim-nju.github.io:8774';
const names = JSON.parse(await fs.readFile('docs/acceptance.json', 'utf8')).fingerprintFiles;
const fingerprint = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(name)).digest('hex')])));
const sources = await fingerprint();
const results = [];
let server;
let browser;
let page;
async function ready() {
  await page.evaluate(async () => {
    window.qaWait = async predicate => {
      const deadline = performance.now() + 30000;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error('condition timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    await qaWait(() => typeof cacheKeys !== 'undefined' && cacheKeys instanceof Set);
  });
}
async function check(name, run) {
  const result = await page.evaluate(run);
  assert.equal(result.pass, true, `${name}: ${JSON.stringify(result)}`);
  results.push({ name, ...result });
  console.log(`PASS ${name}: ${JSON.stringify(result)}`);
}
const options = {
  browserPath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  browserArgs: ['--headless', '--no-first-run', '--no-proxy-server', '--host-resolver-rules=MAP tim-nju.github.io 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${origin}`, '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`],
  storageRoot: profile
};
try {
  server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '8774' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`server exit ${code}`))); });
  browser = await omowright.connectPipe(options);
  page = await browser.newTab(origin);
  await ready();
  console.log(omowright.compactSnapshot(await page.snapshot()));
  await page.evaluate(async () => {
    await AudioStore.download(ORIGINAL_TRACK, new AbortController().signal);
    localStorage.setItem('mw_pos_daodejing-011', '123');
    localStorage.setItem('mw_progress_daodejing-011', '{"completed":true,"furthest":456,"duration":789}');
    localStorage.setItem('mw_pos_hope-workplace-03', '80');
    window.legacyBytes = (await AudioStore.get(ORIGINAL_TRACK.id)).size;
    await refreshCache();
  });
  for (const id of ['bible', 'diamond']) {
    await page.locator('#topicSelect').selectOption(id);
    await page.evaluate(async () => { await qaWait(() => document.getElementById('playerStatus').textContent.includes('尚未导入')); });
  }
  await check('scripture-public-shell-no-private-http', () => ({
    pass: !audio.getAttribute('src') && !performance.getEntriesByType('resource').some(item => /\/audio\/(scripture|diamond)\//.test(item.name)),
    topic: topic.id, status: document.getElementById('playerStatus').textContent
  }));
  await page.locator('#topicSelect').selectOption('bible');
  await page.locator('#filesInput').setInputFiles([path.resolve('public/audio/diamond/diamond-shengyen-01.mp3')]);
  await check('scripture-wrong-topic-file-rejected', () => ({ pass: document.getElementById('btnStartImport').hidden && importPlan.length === 0, preview: document.getElementById('importPreview').textContent }));
  const damaged = await fs.readFile('public/audio/scripture/mw230903.mp3');
  damaged[1024] ^= 255;
  const damagedPath = path.join(temporary, 'mw230903.mp3');
  await fs.writeFile(damagedPath, damaged);
  await page.locator('#filesInput').setInputFiles([damagedPath]);
  await page.locator('#btnStartImport').click();
  await check('scripture-same-size-corruption-rejected', async () => {
    await qaWait(() => !importController);
    return { pass: !(await AudioStore.get('bible-sundazhong-mw230903')) && document.getElementById('importStatus').textContent.includes('校验失败'), message: document.getElementById('importStatus').textContent };
  });
  for (const [id, folder, count] of [['bible', 'scripture', 3], ['diamond', 'diamond', 9]]) {
    await page.locator('#topicSelect').selectOption(id);
    await page.locator('#folderInput').setInputFiles([path.resolve('public/audio/' + folder)]);
    await page.locator('#btnStartImport').click();
    await page.evaluate(async () => { await qaWait(() => !importController); });
    const imported = await page.evaluate(async () => {
      const files = [];
      for (const item of topic.tracks) {
        const blob = await AudioStore.get(item.id);
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
        if (blob.size !== item.bytes || sha256 !== item.sha256) throw new Error(`Stored file mismatch ${item.id}`);
        await selectTrack(item, true);
        await qaWait(() => sourceReady && !audio.paused && audio.currentTime > 0.15);
        audio.pause();
        files.push({ id: item.id, bytes: blob.size, sha256, time: audio.currentTime, duration: audio.duration });
      }
      return { files, message: document.getElementById('importStatus').textContent };
    });
    assert.equal(imported.files.length, count);
    assert.ok(imported.message.includes(`全部 ${count} 集`));
    const name = id === 'bible' ? 'bible-real-folder-import-three' : 'diamond-real-folder-import-nine';
    results.push({ name, pass: true, ...imported });
    console.log(`PASS ${name}: ${JSON.stringify(imported)}`);
    await fs.writeFile(`${output}/${id}-desktop.png`, await page.screenshot());
    await page.locator('#folderInput').setInputFiles([path.resolve('public/audio/' + folder)]);
    await page.locator('#btnStartImport').click();
    await page.evaluate(async () => { await qaWait(() => !importController); });
    const message = await page.evaluate(() => document.getElementById('importStatus').textContent);
    assert.ok(message.includes(`本次导入 0 集，已有 ${count} 集`), message);
  }
  results.push({ name: 'scripture-reimport-skips-verified-files', pass: true, counts: [3, 9] });
  await check('scripture-topic-progress-and-legacy-preserved', async () => {
    await selectTrack(BIBLE_TOPIC.tracks[0]); await qaWait(() => sourceReady); seekTo(125); savePosition();
    await selectTrack(DIAMOND_TOPIC.tracks[0]); await qaWait(() => sourceReady); seekTo(210); savePosition();
    await selectTrack(BIBLE_TOPIC.tracks[0]); await qaWait(() => sourceReady);
    const bible = audio.currentTime;
    await selectTrack(DIAMOND_TOPIC.tracks[0]); await qaWait(() => sourceReady);
    return { pass: Math.abs(bible - 125) < 1 && Math.abs(audio.currentTime - 210) < 1 && localStorage.getItem('mw_pos_daodejing-011') === '123' && JSON.parse(localStorage.getItem('mw_progress_daodejing-011')).completed && localStorage.getItem('mw_pos_hope-workplace-03') === '80' && (await AudioStore.get(ORIGINAL_TRACK.id)).size === legacyBytes && ORIGINAL_TRACK.chapters.length === 12 && COURSE_TOPIC.tracks.length === 107 && HOPE_TOPIC.tracks.length === 1, bible, diamond: audio.currentTime };
  });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; savePosition(); });
  await browser.close(); browser = null;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve)); server = null;
  browser = await omowright.connectPipe(options);
  page = await browser.newTab(origin);
  await ready();
  await page.locator('#btnPlay').click();
  await check('scripture-offline-cold-reopen', async () => {
    await qaWait(() => sourceReady && !audio.paused && audio.currentTime > 210.2);
    audio.pause();
    await selectTrack(BIBLE_TOPIC.tracks[0], true);
    await qaWait(() => sourceReady && !audio.paused && audio.currentTime > 125.2);
    audio.pause();
    return { pass: cacheKeys.size === 13 && audio.currentSrc.startsWith('blob:'), cached: cacheKeys.size, time: audio.currentTime, controller: navigator.serviceWorker.controller.scriptURL };
  });
  await fs.writeFile(`${output}/offline.png`, await page.screenshot());
  assert.deepEqual(await fingerprint(), sources);
} catch (error) {
  if (!(error instanceof Error)) throw error;
  results.push({ name: 'failure', pass: false, error: error.message });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.writeFile(`${output}/import-results.json`, JSON.stringify({ status: process.exitCode ? 'fail' : 'pass', invocation: 'node scripts/scripture-import-check.mjs', surface: 'Owned Chrome, real folder inputs, all twelve actual files, stopped HTTP server and fresh browser process; not iOS', sources, results }, null, 2));
}
