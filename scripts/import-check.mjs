import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const {loadOmowright}=await import(process.env.OMOWRIGHT_DRIVER || '/Users/chuangwen/.codex/plugins/cache/sisyphuslabs/omo/5.1.63/skills/browser/scripts/omowright.mjs');
const {omowright}=await loadOmowright();
const root=process.cwd();
const profile=await fs.mkdtemp(path.join(tmpdir(),'import-browser-'));
const fixture=await fs.mkdtemp(path.join(tmpdir(),'import-files-'));
const output='.omo/evidence/private-import';await fs.mkdir(output,{recursive:true});
const names=JSON.parse(await fs.readFile('docs/acceptance.json','utf8')).fingerprintFiles;
const fingerprint=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await fs.readFile(name)).digest('hex')])));
const sources=await fingerprint();
const results=[];let browser;let server;
const origin='http://tim-nju.github.io:8769';
try{
  server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,PORT:'8769'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`server exited ${code}`)));});
  browser=await omowright.connectPipe({browserPath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',browserArgs:['--headless','--no-first-run','--no-proxy-server','--host-resolver-rules=MAP tim-nju.github.io 127.0.0.1',`--unsafely-treat-insecure-origin-as-secure=${origin}`,'--autoplay-policy=no-user-gesture-required',`--user-data-dir=${profile}`],storageRoot:profile});
  const page=await browser.newTab(origin);
  await page.evaluate(async()=>{
    window.qaWait=async condition=>{const end=performance.now()+90000;while(!condition()){if(performance.now()>end)throw new Error('condition timed out');await new Promise(resolve=>requestAnimationFrame(resolve));}};
    await qaWait(()=>typeof sourceReady!=='undefined'&&sourceReady);
  });
  async function check(name,run){const value=await page.evaluate(run);if(!value.pass)throw new Error(`${name}: ${JSON.stringify(value)}`);results.push({name,...value});console.log(`PASS ${name}: ${JSON.stringify(value)}`);}
  await page.locator('#topicSelect').selectOption('daodejing');
  await page.locator('[data-track-id="daodejing-002"]').click();
  await check('public-shell-never-fetches-private-media',async()=>{
    await qaWait(()=>document.getElementById('playerStatus').textContent.includes('iCloud'));
    return {pass:!canFetchTrack(track)&&!audio.getAttribute('src')&&!performance.getEntriesByType('resource').some(item=>item.name.includes('/daodejing/')&&item.name.endsWith('.m4a')),message:document.getElementById('playerStatus').textContent};
  });
  await fs.writeFile(path.join(fixture,'wrong-name.m4a'),'wrong');
  await page.locator('#filesInput').setInputFiles([path.join(fixture,'wrong-name.m4a')]);
  await check('unknown-file-is-reported-before-import',()=>({pass:document.getElementById('btnStartImport').hidden&&document.getElementById('importPreview').textContent.includes('wrong-name.m4a'),preview:document.getElementById('importPreview').textContent}));
  await fs.mkdir(path.join(fixture,'duplicate/a'),{recursive:true});await fs.mkdir(path.join(fixture,'duplicate/b'),{recursive:true});
  for(const folder of ['a','b'])await fs.copyFile('public/audio/daodejing/002.m4a',path.join(fixture,'duplicate',folder,'002.m4a'));
  await page.locator('#folderInput').setInputFiles([path.join(fixture,'duplicate')]);
  await check('folder-duplicate-names-block-import',()=>({pass:document.getElementById('btnStartImport').disabled&&document.getElementById('importPreview').textContent.includes('重名'),preview:document.getElementById('importPreview').textContent}));
  const corrupt=await fs.readFile('public/audio/daodejing/004.m4a');corrupt[0]^=255;await fs.writeFile(path.join(fixture,'004.m4a'),corrupt);
  await page.locator('#filesInput').setInputFiles([path.join(fixture,'004.m4a')]);await page.locator('#btnStartImport').click();
  await check('same-size-corruption-fails-sha256-without-cache',async()=>{await qaWait(()=>!importController);const blob=await AudioStore.get('daodejing-004');return {pass:!blob&&!cacheKeys.has('daodejing-004')&&document.getElementById('importStatus').textContent.includes('校验失败'),message:document.getElementById('importStatus').textContent};});
  await page.locator('#filesInput').setInputFiles([path.resolve('public/audio/daodejing/002.m4a'),path.resolve('public/audio/daodejing/003.m4a')]);
  await check('partial-selection-requires-explicit-count',()=>({pass:document.getElementById('btnStartImport').textContent==='导入这 2 集'&&document.getElementById('importPreview').textContent.includes('105'),preview:document.getElementById('importPreview').textContent}));
  await page.locator('#btnStartImport').click();
  await check('partial-file-input-import-persists-two-tracks',async()=>{await qaWait(()=>!importController);return {pass:cacheKeys.has('daodejing-002')&&cacheKeys.has('daodejing-003')&&cacheKeys.size===2&&document.getElementById('importStatus').textContent.includes('2/107'),message:document.getElementById('importStatus').textContent};});
  await page.locator('#btnPlay').click();
  await check('newly-imported-selected-track-plays-on-next-click',async()=>{await qaWait(()=>sourceReady&&!audio.paused&&audio.currentTime>0.2);audio.pause();return {pass:track.id==='daodejing-002'&&audio.currentSrc.startsWith('blob:')&&!document.getElementById('playerStatus').textContent.includes('尚未'),src:audio.currentSrc,time:audio.currentTime,status:document.getElementById('playerStatus').textContent};});
  await page.locator('#folderInput').setInputFiles([path.resolve('public/audio/daodejing')]);
  await page.locator('#btnStartImport').click();
  await page.evaluate(async()=>{await qaWait(()=>importController&&cacheKeys.size>2);});
  await page.locator('#btnStopImport').click();
  await check('real-stop-button-keeps-completed-imports',async()=>{await qaWait(()=>!importController);window.cancelledCount=cacheKeys.size;return {pass:cacheKeys.size>2&&cacheKeys.size<107&&document.getElementById('importStatus').textContent.includes('停止'),count:cacheKeys.size,message:document.getElementById('importStatus').textContent};});
  await page.locator('#folderInput').setInputFiles([path.resolve('public/audio/daodejing')]);await page.locator('#btnStartImport').click();
  await check('folder-resume-skips-completed-and-imports-all-107',async()=>{await qaWait(()=>!importController);const message=document.getElementById('importStatus').textContent;return {pass:cacheKeys.size===107&&message.includes(`已有 ${window.cancelledCount} 集`)&&message.includes('全部 107'),count:cacheKeys.size,message};});
  await fs.writeFile(`${output}/import-complete.png`,await page.screenshot());
  server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));server=null;
  await page.goto(origin);
  await page.evaluate(async()=>{window.qaWait=async condition=>{const end=performance.now()+20000;while(!condition()){if(performance.now()>end)throw new Error('offline timeout');await new Promise(resolve=>requestAnimationFrame(resolve));}};await qaWait(()=>typeof sourceReady!=='undefined'&&sourceReady);});
  await check('imported-library-offline-reloads-and-plays-last',async()=>{await selectTrack(COURSE_TOPIC.tracks.at(-1),true);await qaWait(()=>sourceReady&&!audio.paused);seekTo(30);await qaWait(()=>audio.currentTime>30.2);audio.pause();return {pass:track.id==='daodejing-107'&&cacheKeys.size===107&&audio.currentSrc.startsWith('blob:'),count:cacheKeys.size,time:audio.currentTime,src:audio.currentSrc};});
  await fs.writeFile(`${output}/import-offline.png`,await page.screenshot());
  if(JSON.stringify(sources)!==JSON.stringify(await fingerprint()))throw new Error('source changed during run');
}catch(error){results.push({name:'failure',pass:false,error:error instanceof Error?error.stack:String(error)});process.exitCode=1;}
finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');await fs.rm(profile,{recursive:true,force:true});await fs.rm(fixture,{recursive:true,force:true});await fs.writeFile(`${output}/import-results.json`,JSON.stringify({status:process.exitCode?'fail':'pass',invocation:'node scripts/import-check.mjs',surface:'Isolated Chrome with real file inputs; mapped non-loopback hostname models public shell, not a deployed-site test',sources,results},null,2));}
