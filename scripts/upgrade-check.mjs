import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const {loadOmowright}=await import(process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.codex/plugins/cache/sisyphuslabs/omo/5.1.63/skills/browser/scripts/omowright.mjs');
const {omowright}=await loadOmowright();
const root=process.cwd();
// Verified initial single-recording release, matching the stored old-v2 fixtures.
const legacyCommit='ae250e14740a726f190b226e52488f9d6f3581a8';
const currentWorker=(await fs.readFile('app.js','utf8')).match(/serviceWorker\.register\('(\.\/sw\.js\?v=\d+)'\)/)?.[1];
if(!currentWorker)throw new Error('Versioned candidate service worker registration required');
const folder=await fs.mkdtemp(path.join(tmpdir(),'topic-upgrade-'));
const profile=await fs.mkdtemp(path.join(tmpdir(),'topic-upgrade-browser-'));
const manifest=JSON.parse(await fs.readFile('docs/acceptance.json','utf8'));
const names=manifest.fingerprintFiles;
const fingerprints=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')])));
const sources=await fingerprints();
const checks=[];
let server;
let browser;
try {
  for(const name of ['index.html','app.js','styles.css','sw.js','manifest.json']) await fs.writeFile(path.join(folder,name),execFileSync('git',['show',`${legacyCommit}:${name}`]));
  await fs.mkdir(path.join(folder,'public/audio'),{recursive:true});
  await fs.mkdir(path.join(folder,'public/icons'),{recursive:true});
  await fs.link(path.join(root,'public/audio/lixiong-20261031.mp3'),path.join(folder,'public/audio/lixiong-20261031.mp3'));
  for(const name of ['icon-192.png','icon-512.png']) await fs.copyFile(path.join(root,'public/icons',name),path.join(folder,'public/icons',name));
  server=spawn(process.execPath,[path.join(root,'scripts/serve.mjs')],{cwd:folder,env:{...process.env,PORT:'8878'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`server exit ${code}`)));});
  browser=await omowright.connectPipe({browserPath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',browserArgs:['--headless','--no-first-run','--autoplay-policy=no-user-gesture-required',`--user-data-dir=${profile}`],storageRoot:profile});
  const page=await browser.newTab('http://127.0.0.1:8878');
  const seeded=await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    const response=await fetch('./public/audio/lixiong-20261031.mp3');
    const cache=await caches.open('mind-walkman-v2');await cache.put('./public/audio/lixiong-20261031.mp3',response);
    localStorage.setItem('mw_pos','150');
    return {keys:await caches.keys(),position:localStorage.getItem('mw_pos'),controller:(await navigator.serviceWorker.ready).active.scriptURL};
  });
  if(!seeded.keys.includes('mind-walkman-v2')||seeded.position!=='150'||!seeded.controller.endsWith('/sw.js'))throw new Error(JSON.stringify(seeded));
  checks.push({id:'legacy-v2-seeded',status:'pass',observable:seeded});
  for(const name of ['index.html','styles.css','app.js','tracks.js','course-data.js','storage.js','controls.js','importer.js','manifest.json']) await fs.copyFile(path.join(root,name),path.join(folder,name));
  await fs.unlink(path.join(folder,'sw.js'));
  await page.goto('http://127.0.0.1:8878/index.html?mixed-shell=legacy-v2');
  const mixed=await page.evaluate(async()=>{
    const end=performance.now()+20000;while(typeof sourceReady==='undefined'||!sourceReady){if(performance.now()>end)throw new Error('mixed shell ready timeout');await new Promise(resolve=>requestAnimationFrame(resolve));}
    await selectTrack(COURSE_TOPIC.tracks[0]);
    const observed={importVisible:!document.getElementById('importSection').hidden,importFunction:typeof importSelectedFiles,controller:navigator.serviceWorker.controller.scriptURL,keys:await caches.keys()};
    await selectTrack(ORIGINAL_TRACK);
    return observed;
  });
  if(!mixed.importVisible||mixed.importFunction!=='function'||!mixed.keys.includes('mind-walkman-v2')||!mixed.controller.endsWith('/sw.js'))throw new Error(JSON.stringify(mixed));
  checks.push({id:'old-worker-new-html-loads-versioned-importer',status:'pass',observable:mixed});
  await fs.copyFile(path.join(root,'sw.js'),path.join(folder,'sw.js'));
  await page.goto('http://127.0.0.1:8878/index.html?release=candidate');
  await page.evaluate(async expectedWorker=>{
    const end=performance.now()+20000;
    const expectedURL=new URL(expectedWorker,location.href).href;
    while(navigator.serviceWorker.controller?.scriptURL!==expectedURL){if(performance.now()>end)throw new Error('natural update timeout');await new Promise(resolve=>requestAnimationFrame(resolve));}
  },currentWorker);
  const upgraded=await page.evaluate(async()=>{
    const limit=performance.now()+20000;while(typeof sourceReady==='undefined'||!sourceReady){if(performance.now()>limit)throw new Error('metadata timeout');await new Promise(resolve=>requestAnimationFrame(resolve));}
    audio.pause();return {keys:await caches.keys(),position:audio.currentTime,chapters:document.querySelectorAll('.chapter-card').length};
  });
  if(!upgraded.keys.includes('mind-walkman-v2')||Math.abs(upgraded.position-150)>1||upgraded.chapters!==12)throw new Error(JSON.stringify(upgraded));
  checks.push({id:'upgrade-preserves-v2-audio-and-progress',status:'pass',observable:upgraded});
  server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));server=null;
  await page.goto('http://127.0.0.1:8878');
  const offline=await page.evaluate(async()=>{
    const limit=performance.now()+20000;while(typeof sourceReady==='undefined'||!sourceReady){if(performance.now()>limit)throw new Error('offline metadata timeout');await new Promise(resolve=>requestAnimationFrame(resolve));}
    seekTo(180);await playAudio();
    while(audio.currentTime<180.2){if(performance.now()>limit)throw new Error('offline playback timeout');await new Promise(resolve=>requestAnimationFrame(resolve));}
    audio.pause();return {time:audio.currentTime,src:audio.currentSrc,ready:audio.readyState};
  });
  if(offline.time<180.2||offline.time>182)throw new Error(JSON.stringify(offline));
  checks.push({id:'upgraded-v2-offline-reload-seek-play',status:'pass',observable:offline});
  await fs.writeFile('.omo/evidence/topic-player/upgrade.png',await page.screenshot());
  if(JSON.stringify(sources)!==JSON.stringify(await fingerprints()))throw new Error('source changed during upgrade scenario');
} catch(error) {checks.push({id:'failure',status:'fail',error:error instanceof Error?error.stack:String(error)});process.exitCode=1;}
finally {
  if(browser)await browser.close();if(server)server.kill('SIGTERM');
  await fs.rm(folder,{recursive:true,force:true});await fs.rm(profile,{recursive:true,force:true});
  await fs.writeFile('.omo/evidence/topic-player/upgrade-results.json',JSON.stringify({status:process.exitCode?'fail':'pass',invocation:'node scripts/upgrade-check.mjs',legacyCommit,currentWorker,sources,checks,artifacts:['.omo/evidence/topic-player/upgrade.png']},null,2));
  console.log(JSON.stringify(checks,null,2));
}
