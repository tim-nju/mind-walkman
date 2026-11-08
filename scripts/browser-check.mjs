import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const driver = process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.codex/plugins/cache/sisyphuslabs/omo/5.1.63/skills/browser/scripts/omowright.mjs';
const { loadOmowright } = await import(driver);
const { omowright } = await loadOmowright();
const profile = await fs.mkdtemp('/private/tmp/topic-qa-');
const output = path.resolve('.omo/evidence/topic-player');
await fs.mkdir(output, { recursive: true });
const browser = await omowright.connectPipe({ browserPath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', browserArgs: ['--headless', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`], storageRoot: profile });
const results = [];
const sourceNames = JSON.parse(await fs.readFile('docs/acceptance.json','utf8')).fingerprintFiles;
const initialSources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name,createHash('sha256').update(await fs.readFile(name)).digest('hex')])));
try {
  const page = await browser.newTab(process.env.PLAYER_URL || 'http://127.0.0.1:8767');
  await page.evaluate(async () => {
    window.qaWait = async predicate => {
      const end = performance.now() + 20000;
      while (!predicate()) {
        if (performance.now() > end) throw new Error('condition timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    await qaWait(() => sourceReady);
  });
  async function check(name, run) {
    const observable = await page.evaluate(run);
    if (observable.pass !== true) throw new Error(`${name}: ${JSON.stringify(observable)}`);
    results.push({ name, ...observable });
    console.log(`PASS ${name}: ${JSON.stringify(observable)}`);
  }
  await check('legacy-position-and-original-chapters', async () => {
    await selectTrack(COURSE_TOPIC.tracks[0]); await qaWait(() => sourceReady);
    localStorage.removeItem('mw_pos_lixiong-20261031');
    localStorage.setItem('mw_pos', '150');
    await selectTrack(ORIGINAL_TRACK); await qaWait(() => sourceReady);
    return { pass: Math.abs(audio.currentTime - 150) < 1 && document.querySelectorAll('.chapter-card').length === 12, time: audio.currentTime, chapters: document.querySelectorAll('.chapter-card').length };
  });
  await check('per-track-progress-speed-and-playback', async () => {
    await selectTrack(COURSE_TOPIC.tracks[1]); await qaWait(() => sourceReady);
    seekTo(20); document.getElementById('btnSpeed').click();
    await selectTrack(COURSE_TOPIC.tracks[2]); await qaWait(() => sourceReady);
    seekTo(30);
    await selectTrack(COURSE_TOPIC.tracks[1]); await qaWait(() => sourceReady);
    const restored = audio.currentTime;
    await playAudio(); await qaWait(() => audio.currentTime > restored + 0.2); audio.pause();
    return { pass: Math.abs(restored - 20) < 1 && audio.playbackRate === 1.25 && Number(localStorage.getItem('mw_pos_daodejing-003')) === 30, restored, rate: audio.playbackRate, time: audio.currentTime };
  });
  await check('switch-before-metadata-preserves-bookmark', async () => {
    await selectTrack(COURSE_TOPIC.tracks[2]); await qaWait(()=>sourceReady);
    localStorage.setItem('mw_pos_daodejing-001','120');
    await selectTrack(COURSE_TOPIC.tracks[0]);
    const readyBeforeSwitch=sourceReady;
    await selectTrack(COURSE_TOPIC.tracks[2]); await qaWait(()=>sourceReady);
    return {pass:!readyBeforeSwitch && localStorage.getItem('mw_pos_daodejing-001')==='120',readyBeforeSwitch,position:localStorage.getItem('mw_pos_daodejing-001')};
  });
  await check('delayed-cache-read-cannot-replace-latest-track', async () => {
    const original = AudioStore.get;
    let release;
    AudioStore.get = id => id === 'daodejing-001' ? new Promise(resolve => { release = resolve; }) : original(id);
    try {
      const first = selectTrack(COURSE_TOPIC.tracks[0]);
      await selectTrack(COURSE_TOPIC.tracks[2]); await qaWait(() => sourceReady);
      release(new Blob(['invalid old source'], { type:'audio/mp4' })); await first;
      return { pass: track.id === 'daodejing-003' && audio.currentSrc.includes('003.m4a'), id:track.id, src:audio.currentSrc };
    } finally { AudioStore.get = original; }
  });
  await check('cache-commit-keeps-current-source-and-mime', async () => {
    const source = audio.currentSrc;
    await downloadTracks([COURSE_TOPIC.tracks[1]]);
    const blob = await AudioStore.get('daodejing-002');
    return { pass: blob instanceof Blob && blob.type === 'audio/mp4' && audio.currentSrc === source, type:blob?.type, bytes:blob?.size, src:audio.currentSrc };
  });
  await check('quota-failure-keeps-prior-cache', async () => {
    const original = AudioStore.put;
    AudioStore.put = async () => { throw new DOMException('disk full', 'QuotaExceededError'); };
    try {
      await downloadTracks([COURSE_TOPIC.tracks[3]]);
      return { pass: cacheKeys.has('daodejing-002') && !cacheKeys.has('daodejing-004') && document.getElementById('cacheStatus').textContent.includes('失败'), status:document.getElementById('cacheStatus').textContent };
    } finally { AudioStore.put = original; }
  });
  await check('stop-queue-keeps-completed-track', async () => {
    const original = AudioStore.download;
    AudioStore.download = async (item, signal) => { if (item.id === 'daodejing-003') { downloadController.abort(); throw new DOMException('stopped','AbortError'); } return original.call(AudioStore,item,signal); };
    try {
      await downloadTracks([COURSE_TOPIC.tracks[1], COURSE_TOPIC.tracks[2], COURSE_TOPIC.tracks[3]]);
      return { pass: cacheKeys.has('daodejing-002') && !cacheKeys.has('daodejing-003') && !cacheKeys.has('daodejing-004'), status:document.getElementById('cacheStatus').textContent };
    } finally { AudioStore.download = original; }
  });
  await check('real-indexeddb-abort-does-not-report-cached', async () => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      const tx = original.apply(this,args);
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    };
    try {
      await downloadTracks([COURSE_TOPIC.tracks[3]]);
      const blob = await AudioStore.get('daodejing-004');
      return {pass:!blob && !cacheKeys.has('daodejing-004') && document.getElementById('cacheStatus').textContent.includes('停止'), stored:!!blob, status:document.getElementById('cacheStatus').textContent};
    } finally { IDBDatabase.prototype.transaction = original; }
  });
  await check('invalid-audio-rejected-before-cache', async () => {
    const original = window.fetch;
    window.fetch = async () => new Response('not audio',{status:200,headers:{'Content-Type':'audio/mp4'}});
    try {
      await downloadTracks([COURSE_TOPIC.tracks[3]]);
      return {pass:!cacheKeys.has('daodejing-004') && document.getElementById('cacheStatus').textContent.includes('失败'),status:document.getElementById('cacheStatus').textContent};
    } finally {window.fetch=original;}
  });
  await check('legacy-indexeddb-blob-remains-playable', async () => {
    const originalBlob=await (await fetch(ORIGINAL_TRACK.audioSrc)).blob();
    await AudioStore.put(ORIGINAL_TRACK.id,originalBlob);
    await selectTrack(ORIGINAL_TRACK); await qaWait(()=>sourceReady);
    const restored=audio.currentTime;
    await playAudio(); await qaWait(()=>audio.currentTime>restored+0.1); audio.pause();
    return {pass:audio.currentSrc.startsWith('blob:') && audio.duration>4600 && audio.duration<4620,src:audio.currentSrc,duration:audio.duration,time:audio.currentTime};
  });
  await check('natural-ended-advances-and-resets-bookmark', async () => {
    loopMode = 'normal'; applyLoop();
    await selectTrack(COURSE_TOPIC.tracks[1]); await qaWait(() => sourceReady);
    seekTo(audio.duration - 0.1); await playAudio();
    await qaWait(() => track.id === 'daodejing-003' && sourceReady && !audio.paused);
    audio.pause();
    return { pass: localStorage.getItem('mw_pos_daodejing-002') === '0' && progressLabel(COURSE_TOPIC.tracks[1]) === '已听 100% · 已听完', id:track.id, priorPosition:localStorage.getItem('mw_pos_daodejing-002') };
  });
  await check('final-ended-stops-and-can-replay', async () => {
    await selectTrack(COURSE_TOPIC.tracks.at(-1)); await qaWait(() => sourceReady);
    seekTo(audio.duration - 0.1); await playAudio(); await qaWait(() => audio.ended);
    const stopped = audio.paused && track.id === 'daodejing-107';
    await playAudio(); await qaWait(() => !audio.paused && audio.currentTime > 0.1); audio.pause();
    return { pass:stopped && audio.currentTime < 5, id:track.id, replayTime:audio.currentTime };
  });
  await check('completed-survives-replay-and-reload-storage', async () => {
    await selectTrack(COURSE_TOPIC.tracks[1]); await qaWait(() => sourceReady);
    seekTo(10); savePosition();
    return {pass:progressLabel(track)==='已听 100% · 已听完' && savedPosition(track)===10,label:progressLabel(track)};
  });
  await check('single-repeat-records-completion', async () => {
    await selectTrack(COURSE_TOPIC.tracks[3]); await qaWait(() => sourceReady);
    loopMode='one'; applyLoop(); seekTo(audio.duration-0.1); await playAudio();
    await qaWait(()=>readProgress(track).completed && audio.currentTime<5 && !audio.paused);
    audio.pause(); return {pass:track.id==='daodejing-004' && !audio.loop && progressLabel(track).includes('100%'),label:progressLabel(track)};
  });
  await check('legacy-partial-corrupt-and-unknown-progress', async () => {
    const item=COURSE_TOPIC.tracks[5];
    localStorage.removeItem(`mw_progress_${item.id}`); localStorage.setItem(`mw_pos_${item.id}`,String(item.duration/2));
    const legacy=progressLabel(item);
    localStorage.setItem(`mw_progress_${item.id}`,'{broken'); const corrupt=progressLabel(item);
    localStorage.setItem(`mw_progress_${item.id}`,'{}'); const invalidObject=progressLabel(item);
    localStorage.setItem(`mw_pos_${item.id}`,'0'); const oldZero=progressLabel(item);
    const unknown=progressLabel({id:'unknown-qa',duration:0});
    localStorage.setItem('mw_progress_rounding-qa',JSON.stringify({furthest:99.99,duration:100}));
    const rounded=progressLabel({id:'rounding-qa',duration:100});
    return {pass:legacy==='已听 50%' && corrupt===legacy && invalidObject===legacy && oldZero==='已听 0%' && unknown==='进度未知' && rounded==='已听 99%',legacy,corrupt,oldZero,unknown,rounded};
  });
  await check('pause-updates-visible-percentage-without-rebuilding-list', async () => {
    await selectTrack(COURSE_TOPIC.tracks[6]); await qaWait(()=>sourceReady);
    const row=document.querySelector(`[data-track-id="${track.id}"]`);
    seekTo(audio.duration/2); await playAudio(); audio.pause();
    return {pass:row===document.querySelector(`[data-track-id="${track.id}"]`) && row.textContent.includes('已听 50%'),text:row.textContent};
  });
  await fs.writeFile(path.join(output,'browser.png'),await page.screenshot());
} catch (error) {
  results.push({ name:'failure', pass:false, error:error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
} finally {
  await browser.close(); await fs.rm(profile,{recursive:true,force:true});
  const sources = {};
  for (const name of sourceNames) sources[name] = createHash('sha256').update(await fs.readFile(name)).digest('hex');
  if (JSON.stringify(sources) !== JSON.stringify(initialSources)) { process.exitCode = 1; results.push({name:'source-changed-during-run',pass:false}); }
  await fs.writeFile(path.join(output,'browser-results.json'), JSON.stringify({ status:process.exitCode ? 'fail':'pass', invocation:'node scripts/browser-check.mjs', sources, results },null,2));
}
