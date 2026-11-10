import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const driver = process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.omo/binary-runtime/5.1.65/plugin/skills/browser/scripts/omowright.mjs';
const { loadOmowright } = await import(driver);
const { omowright } = await loadOmowright();

const profile = await fs.mkdtemp('/private/tmp/topic-locator-qa-');
const port = 8789;

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

console.log('Server started on port', port);

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

  const page = await browser.newTab(`http://127.0.0.1:${port}/`);
  await page.evaluate(async () => {
    window.qaWait = async predicate => {
      const end = performance.now() + 15000;
      while (!predicate()) {
        if (performance.now() > end) throw new Error('condition timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    await qaWait(() => sourceReady);
  });

  console.log('Page loaded, sourceReady true');

  // Step 1: Switch to daodejing and select Episode 45
  const step1Result = await page.evaluate(async () => {
    const select = document.getElementById('topicSelect');
    select.value = 'daodejing';
    select.dispatchEvent(new Event('change'));
    await qaWait(() => document.getElementById('trackList').children.length === 107);

    // Click episode 45
    const btn = document.querySelector('[data-track-id="daodejing-045"]');
    btn.click();
    await qaWait(() => track.id === 'daodejing-045' && sourceReady);

    return {
      trackId: track.id,
      title: document.getElementById('trackTitle').textContent,
      persistedTopicTrack: localStorage.getItem('mw_lastTrack_daodejing'),
      globalLastTrack: localStorage.getItem('mw_lastTrack')
    };
  });
  console.log('Step 1 (Select daodejing-045):', step1Result);
  if (step1Result.trackId !== 'daodejing-045') throw new Error('Failed step 1');

  // Step 2: Switch to lixiong topic
  const step2Result = await page.evaluate(async () => {
    const select = document.getElementById('topicSelect');
    select.value = 'lixiong';
    select.dispatchEvent(new Event('change'));
    await qaWait(() => track.id === 'lixiong-20261031' && sourceReady);
    return {
      trackId: track.id,
      title: document.getElementById('trackTitle').textContent
    };
  });
  console.log('Step 2 (Switch to lixiong):', step2Result);

  // Step 3: Switch back to daodejing. Must automatically locate episode 45!
  const step3Result = await page.evaluate(async () => {
    const select = document.getElementById('topicSelect');
    select.value = 'daodejing';
    select.dispatchEvent(new Event('change'));
    await qaWait(() => track.id === 'daodejing-045' && sourceReady);

    const activeRow = document.querySelector('.track-row[aria-current="true"]');
    return {
      trackId: track.id,
      title: document.getElementById('trackTitle').textContent,
      activeRowTrackId: activeRow ? activeRow.dataset.trackId : null,
      pulseActive: activeRow ? activeRow.classList.contains('track-row-locate-pulse') : false
    };
  });
  console.log('Step 3 (Switch back to daodejing auto-locates episode 45):', step3Result);
  if (step3Result.trackId !== 'daodejing-045' || step3Result.activeRowTrackId !== 'daodejing-045') {
    throw new Error('Step 3 FAILED: Did not auto-locate to episode 45');
  }

  // Step 4: Test locate buttons
  const step4Result = await page.evaluate(async () => {
    const btnLocateInList = document.getElementById('btnLocateInList');
    const btnLocateTrack = document.getElementById('btnLocateTrack');
    if (!btnLocateInList || !btnLocateTrack) throw new Error('Locate buttons missing from DOM');

    btnLocateInList.click();
    await new Promise(r => setTimeout(r, 50));
    const activeRow = document.querySelector('.track-row[aria-current="true"]');
    const hasPulse = activeRow.classList.contains('track-row-locate-pulse');

    return {
      btnLocateInListExists: !!btnLocateInList,
      btnLocateTrackExists: !!btnLocateTrack,
      hasPulse
    };
  });
  console.log('Step 4 (Locate buttons verify):', step4Result);

  console.log('ALL BROWSER E2E TESTS PASSED SUCCESSFULLY!');
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
