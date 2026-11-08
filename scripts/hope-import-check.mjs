import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const { loadOmowright } = await import(process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.codex/plugins/cache/sisyphuslabs/omo/5.1.63/skills/browser/scripts/omowright.mjs');
const { omowright } = await loadOmowright();
const output = '.omo/evidence/hope';
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp('/private/tmp/hope-release.9IHTLq/executor-st01a1bbfd/browser-');
const profile = path.join(temporary, 'profile');
const origin = 'http://tim-nju.github.io:8773';
const names = JSON.parse(await fs.readFile('docs/acceptance.json', 'utf8')).fingerprintFiles;
const fingerprint = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await fs.readFile(name)).digest('hex')])));
const sources = await fingerprint();
const backup = JSON.parse(await fs.readFile('docs/qa/hope-backup-receipt.json', 'utf8'));
const results = [];
let server;
let browser;
let page;
async function ready() {
  await page.evaluate(async () => {
    window.qaWait = async predicate => {
      const end = performance.now() + 15000;
      while (!predicate()) {
        if (performance.now() > end) throw new Error('condition timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    await qaWait(() => typeof sourceReady !== 'undefined' && cacheKeys instanceof Set);
  });
}
async function check(name, run) {
  const result = await page.evaluate(run);
  assert.equal(result.pass, true, `${name}: ${JSON.stringify(result)}`);
  results.push({ name, ...result });
  console.log(`PASS ${name}: ${JSON.stringify(result)}`);
}
try {
  server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '8773' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`server ${code}`))); });
  const options = { browserPath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', browserArgs: ['--headless', '--no-first-run', '--no-proxy-server', '--host-resolver-rules=MAP tim-nju.github.io 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${origin}`, '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`], storageRoot: profile };
  browser = await omowright.connectPipe(options);
  page = await browser.newTab(origin);
  await ready();
  // Seed actual existing media and bookmarks in this isolated profile only.
  await page.evaluate(async () => {
    await AudioStore.download(ORIGINAL_TRACK, new AbortController().signal);
    localStorage.setItem('mw_pos_daodejing-011', '123');
    localStorage.setItem('mw_progress_daodejing-011', '{"completed":true,"furthest":456,"duration":789}');
    window.originalSize = (await AudioStore.get(ORIGINAL_TRACK.id)).size;
    window.originalHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await (await AudioStore.get(ORIGINAL_TRACK.id)).arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
    await refreshCache();
  });
  await page.locator('#topicSelect').selectOption('hope-workplace');
  await page.locator('#filesInput').setInputFiles([path.resolve('public/audio/hope/hope-workplace-03.mp3')]);
  await page.locator('#topicSelect').selectOption('daodejing');
  await check('topic-switch-clears-unexecuted-plan', () => ({ pass: document.getElementById('btnStartImport').hidden && importPlan.length === 0 && topic.tracks.length === 107 }));
  await page.locator('#topicSelect').selectOption('hope-workplace');
  const corrupt = await fs.readFile('public/audio/hope/hope-workplace-03.mp3');
  corrupt[1024] ^= 255;
  const corruptPath = path.join(temporary, 'hope-workplace-03.mp3');
  await fs.writeFile(corruptPath, corrupt);
  await page.locator('#filesInput').setInputFiles([corruptPath]);
  await page.locator('#btnStartImport').click();
  await check('hope-same-size-corruption-rejected', async () => {
    await qaWait(() => !importController);
    return { pass: !(await AudioStore.get('hope-workplace-03')) && document.getElementById('importStatus').textContent.includes('校验失败'), message: document.getElementById('importStatus').textContent };
  });
  await page.locator('#filesInput').setInputFiles([path.resolve('public/audio/hope/hope-workplace-03.mp3')]);
  await page.evaluate(() => {
    document.getElementById('btnStartImport').click();
    if (!importController) throw new Error('Import must be running before switching topics');
    const select = document.getElementById('topicSelect');
    select.value = 'daodejing';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await check('running-import-remains-bound-to-selected-topic', async () => {
    await qaWait(() => !importController);
    return { pass: topic.id === 'daodejing' && cacheKeys.has('hope-workplace-03') && document.getElementById('importStatus').textContent.includes('全部 1 集') && !document.getElementById('importStatus').textContent.includes('全部 107 集'), message: document.getElementById('importStatus').textContent };
  });
  await page.locator('#topicSelect').selectOption('hope-workplace');
  await page.evaluate(async () => { await qaWait(() => !importController && cacheKeys.has('hope-workplace-03')); });
  await page.locator('#btnPlay').click();
  await check('hope-real-file-input-import-and-play', async () => {
    await qaWait(() => sourceReady && !audio.paused && audio.currentTime > 0.3);
    audio.pause();
    seekTo(120);
    return { pass: audio.paused && audio.currentTime === 120 && audio.currentSrc.startsWith('blob:') && track.id === 'hope-workplace-03', time: audio.currentTime, duration: audio.duration, message: document.getElementById('importStatus').textContent };
  });
  await check('hope-import-preserves-existing-progress-and-audio', async () => {
    const old = await AudioStore.get(ORIGINAL_TRACK.id);
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await old.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
    return { pass: old.size === originalSize && sha === originalHash && localStorage.getItem('mw_pos_daodejing-011') === '123' && localStorage.getItem('mw_progress_daodejing-011') === '{"completed":true,"furthest":456,"duration":789}' && COURSE_TOPIC.tracks.length === 107, bytes: old.size, sha256: sha };
  });
  await fs.writeFile(`${output}/desktop.png`, await page.screenshot());
  // Remove only the new episode in the disposable profile, then restore through the real input.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('MindWalkmanDB', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('audio_files', 'readwrite'); tx.objectStore('audio_files').delete('hope-workplace-03'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    await refreshCache();
  });
  await page.locator('#filesInput').setInputFiles([path.join(backup.destination, 'hope-workplace-03.mp3')]);
  await page.locator('#btnStartImport').click();
  await check('hope-restore-from-private-backup', async () => {
    await qaWait(() => !importController && cacheKeys.has('hope-workplace-03'));
    const blob = await AudioStore.get('hope-workplace-03');
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
    return { pass: blob.size === HOPE_TOPIC.tracks[0].bytes && sha === HOPE_TOPIC.tracks[0].sha256, bytes: blob.size, sha256: sha };
  });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; savePosition(); });
  await browser.close();
  browser = null;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
  server = null;
  browser = await omowright.connectPipe(options);
  page = await browser.newTab(origin);
  await ready();
  await page.locator('#btnPlay').click();
  await check('hope-offline-cold-reopen', async () => {
    await qaWait(() => sourceReady && !audio.paused && audio.currentTime > 120.2);
    audio.pause();
    return { pass: track.id === 'hope-workplace-03' && audio.currentSrc.startsWith('blob:') && localStorage.getItem('mw_pos_daodejing-011') === '123', time: audio.currentTime, cacheCount: cacheKeys.size };
  });
  await fs.writeFile(`${output}/offline.png`, await page.screenshot());
  assert.deepEqual(await fingerprint(), sources);
} catch (error) {
  if (!(error instanceof Error)) throw error;
  const state = page ? await page.evaluate(() => ({ track: track.id, ready: sourceReady, paused: audio.paused, time: audio.currentTime, src: audio.currentSrc, status: document.getElementById('playerStatus').textContent })) : null;
  results.push({ name: 'failure', pass: false, error: error.stack, state });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.writeFile(`${output}/import-results.json`, JSON.stringify({ status: process.exitCode ? 'fail' : 'pass', invocation: 'node scripts/hope-import-check.mjs', surface: 'Isolated Chrome real file inputs, private backup readback, browser process restart with HTTP server stopped; not iOS or deployment', sources, results }, null, 2));
}
