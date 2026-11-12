import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const driver = process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.omo/binary-runtime/5.1.65/plugin/skills/browser/scripts/omowright.mjs';
const { loadOmowright } = await import(driver);
const { omowright } = await loadOmowright();

const profile = await fs.mkdtemp('/private/tmp/counseling-qa-');
const port = 8791;

// Start serve
const server = spawn('node', ['scripts/serve.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOut = '';
server.stdout.on('data', d => { serverOut += d.toString(); });
server.stderr.on('data', d => { serverOut += d.toString(); });

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server start timed out: ' + serverOut)), 5000);
  const checkInterval = setInterval(() => {
    if (serverOut.includes(String(port))) {
      clearInterval(checkInterval);
      clearTimeout(timeout);
      resolve();
    }
  }, 100);
});

console.log(`Server started on port ${port}`);

let browser;
try {
  browser = await omowright.connectPipe({
    browserPath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    browserArgs: [
      '--headless',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${profile}`
    ],
    storageRoot: profile
  });

  const page = await browser.newTab(`http://127.0.0.1:${port}/index.html`);
  await page.evaluate(async () => {
    window.qaWait = async predicate => {
      const end = performance.now() + 15000;
      while (!predicate()) {
        if (performance.now() > end) throw new Error('condition timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    await qaWait(() => typeof sourceReady !== 'undefined');
  });

  // 1. Verify Topics Bar has Counseling
  const topicsData = await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('.topic-pill')).map(p => ({
      id: p.dataset.topicId,
      title: p.querySelector('span:first-child')?.textContent?.trim()
    }));
    return {
      pills,
      topicsInApp: topics.map(t => ({ id: t.id, title: t.title, count: t.tracks.length }))
    };
  });

  console.log('Topics in app:', topicsData.topicsInApp);
  console.log('Topic pills in UI:', topicsData.pills);

  const counselingTopic = topicsData.topicsInApp.find(t => t.id === 'counseling');
  assert.ok(counselingTopic, 'Counseling topic must exist in topics array');
  assert.match(counselingTopic.title, /心理咨询/);

  const counselingPill = topicsData.pills.find(t => t.id === 'counseling');
  assert.ok(counselingPill, 'Counseling topic pill must exist in UI segmented bar');
  console.log('PASS: Counseling topic and pill are present in UI');

  // 2. Select counseling topic and verify selection
  const selectResult = await page.evaluate(async () => {
    const pill = document.querySelector('[data-topic-id="counseling"]');
    pill.click();
    await qaWait(() => topic?.id === 'counseling');
    return {
      topicId: topic.id,
      topicTitle: topic.title,
      trackId: track.id,
      trackTitle: track.title,
      playerTrackTitle: document.getElementById('trackTitle').textContent,
      playerStatus: document.getElementById('playerStatus').textContent
    };
  });

  console.log('Selection result after clicking counseling:', selectResult);
  assert.equal(selectResult.topicId, 'counseling');
  assert.match(selectResult.trackTitle, /心理咨询/);
  console.log('PASS: Successfully selected counseling topic and track');

  // 3. Verify multi-topic batch import recognition
  const importSummary = await page.evaluate(() => {
    const fakeFiles = [
      new File(['dummy1'], '001.m4a'),
      new File(['dummy2'], 'mw230903.mp3'),
      new File(['dummy3'], 'hope-workplace-03.mp3'),
      new File(['dummy4'], '心理咨询-2026-11-01.m4a')
    ];
    showImportSelection(fakeFiles);
    return {
      preview: document.getElementById('importPreview').textContent,
      btnStartText: document.getElementById('btnStartImport').textContent,
      btnStartHidden: document.getElementById('btnStartImport').hidden,
      planLength: importPlan.length
    };
  });

  console.log('Multi-topic import preview:', importSummary);
  assert.equal(importSummary.planLength, 4, 'Should recognize all 4 files across 4 different topics');
  assert.match(importSummary.preview, /跨专题自动识别/);
  assert.match(importSummary.btnStartText, /一键导入这 4 集/);
  assert.equal(importSummary.btnStartHidden, false);
  console.log('PASS: Multi-topic universal import successfully recognized 4 files across 4 topics!');

  await browser.close();
  console.log('ALL COUNSELING & MULTI-IMPORT BROWSER TESTS PASSED!');
} finally {
  server.kill('SIGTERM');
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
