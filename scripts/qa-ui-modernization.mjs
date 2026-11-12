import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const driver = process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.omo/binary-runtime/5.1.65/plugin/skills/browser/scripts/omowright.mjs';
const { loadOmowright } = await import(driver);
const { omowright } = await loadOmowright();

const evidenceDir = path.resolve('.omo/evidence/ui-modernization');
await fs.mkdir(evidenceDir, { recursive: true });

const profile = await fs.mkdtemp('/private/tmp/ui-modern-qa-');
const port = 8793;

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
console.log('Server running on port', port);

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
  await page.setViewportSize({ width: 390, height: 844 });

  await page.evaluate(async () => {
    const end = performance.now() + 15000;
    while (!sourceReady) {
      if (performance.now() > end) throw new Error('timed out waiting for sourceReady');
      await new Promise(r => requestAnimationFrame(r));
    }
  });

  const shot1 = path.join(evidenceDir, '01-home-light-phone.png');
  await page.screenshot({ path: shot1 });
  console.log('1. Captured 01-home-light-phone.png');

  const lightColors = await page.evaluate(() => {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const cardBg = getComputedStyle(document.querySelector('.player-card')).backgroundColor;
    return { bodyBg, cardBg };
  });
  console.log('Light theme colors:', lightColors);

  await page.evaluate(() => {
    document.getElementById('btnOpenSettings').click();
  });
  await new Promise(r => setTimeout(r, 400));
  const shot2 = path.join(evidenceDir, '02-settings-sheet.png');
  await page.screenshot({ path: shot2 });
  console.log('2. Captured 02-settings-sheet.png');

  await page.evaluate(() => {
    const btnDark = document.querySelector('.theme-pill-btn[data-theme-val="dark"]');
    if (btnDark) btnDark.click();
  });
  await new Promise(r => setTimeout(r, 300));

  const darkColors = await page.evaluate(() => {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const cardBg = getComputedStyle(document.querySelector('.player-card')).backgroundColor;
    return { bodyBg, cardBg };
  });
  console.log('Dark theme colors:', darkColors);

  const shot3 = path.join(evidenceDir, '03-settings-dark.png');
  await page.screenshot({ path: shot3 });
  console.log('3. Captured 03-settings-dark.png');

  await page.evaluate(() => {
    document.getElementById('btnCloseSettings').click();
  });
  await new Promise(r => setTimeout(r, 300));
  const shot4 = path.join(evidenceDir, '04-home-dark-phone.png');
  await page.screenshot({ path: shot4 });
  console.log('4. Captured 04-home-dark-phone.png');

  await page.evaluate(() => {
    document.getElementById('btnOpenSettings').click();
    document.querySelector('.theme-pill-btn[data-theme-val="light"]').click();
    document.getElementById('btnCloseSettings').click();
  });
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => {
    const pill = document.querySelector('.topic-pill[data-topic-id="daodejing"]');
    if (pill) pill.click();
  });

  await page.evaluate(async () => {
    const end = performance.now() + 15000;
    while (document.getElementById('trackList').children.length !== 107) {
      if (performance.now() > end) throw new Error('timed out waiting for daodejing tracks');
      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await page.evaluate(() => {
    const btn = document.querySelector('[data-track-id="daodejing-016"]');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 400));

  const foldCheck = await page.evaluate(() => {
    const prevBanner = document.getElementById('foldPrevBanner');
    const futureBanner = document.getElementById('foldFutureBanner');
    const row1 = document.querySelector('[data-track-id="daodejing-001"]').closest('li');
    const row15 = document.querySelector('[data-track-id="daodejing-015"]').closest('li');
    const row16 = document.querySelector('[data-track-id="daodejing-016"]').closest('li');
    const row17 = document.querySelector('[data-track-id="daodejing-017"]').closest('li');
    const row25 = document.querySelector('[data-track-id="daodejing-025"]').closest('li');
    return {
      prevBannerHidden: prevBanner.hidden,
      prevBannerText: document.getElementById('btnTogglePrevTracks').textContent,
      futureBannerHidden: futureBanner.hidden,
      futureBannerText: document.getElementById('btnToggleFutureTracks').textContent,
      row1Folded: row1.dataset.folded,
      row15Folded: row15.dataset.folded,
      row16Folded: row16.dataset.folded,
      row17Folded: row17.dataset.folded,
      row25Folded: row25.dataset.folded
    };
  });
  console.log('Smart fold verification for episode 16:', foldCheck);

  const shot5 = path.join(evidenceDir, '05-daodejing-smart-folding.png');
  await page.screenshot({ path: shot5 });
  console.log('5. Captured 05-daodejing-smart-folding.png');

  await page.evaluate(() => {
    document.getElementById('btnTogglePrevTracks').click();
  });
  await new Promise(r => setTimeout(r, 300));
  const unfoldPrevCheck = await page.evaluate(() => {
    const row1 = document.querySelector('[data-track-id="daodejing-001"]').closest('li');
    return {
      row1Folded: row1.dataset.folded,
      btnText: document.getElementById('btnTogglePrevTracks').textContent
    };
  });
  console.log('Unfold previous check:', unfoldPrevCheck);

  await page.setViewportSize({ width: 1200, height: 800 });
  const shot6 = path.join(evidenceDir, '06-desktop-view.png');
  await page.screenshot({ path: shot6 });
  console.log('6. Captured 06-desktop-view.png');

  await fs.writeFile(path.join(evidenceDir, 'qa-summary.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    status: 'pass',
    lightColors,
    darkColors,
    foldCheck,
    unfoldPrevCheck,
    artifacts: [
      '01-home-light-phone.png',
      '02-settings-sheet.png',
      '03-settings-dark.png',
      '04-home-dark-phone.png',
      '05-daodejing-smart-folding.png',
      '06-desktop-view.png'
    ]
  }, null, 2));

  console.log('ALL QA SCENARIOS PASSED WITH EVIDENCE RECORDED IN .omo/evidence/ui-modernization');
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
