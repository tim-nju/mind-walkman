import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const evidence = path.resolve(process.env.EVIDENCE_DIR || '.omo/evidence/topic-player');
await fs.mkdir(evidence,{recursive:true});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceNames = JSON.parse(await fs.readFile('docs/acceptance.json','utf8')).fingerprintFiles;
const sources = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name,hash(await fs.readFile(name))])));
const checks = [];
async function check(id, action) {
  try { const detail = await action(); checks.push({id,status:'pass',detail}); }
  catch (error) { checks.push({id,status:'fail',detail:error instanceof Error ? error.message : String(error)}); }
}
async function receipt(file) {
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(value.status!=='pass') throw new Error(`${file}: ${value.status}: ${value.reason || ''}`);
  return value;
}
function fresh(value) {
  for(const [name,sha] of Object.entries(sources)) if(value.sources?.[name]!==sha) throw new Error(`过期或缺少源码指纹 ${name}`);
}
const manifest=JSON.parse(await fs.readFile('docs/acceptance.json','utf8'));
for(const required of manifest.required) await check(required.id,async()=>{
  switch(required.kind) {
    case 'media': {
      const context=vm.createContext({});
      vm.runInContext(await fs.readFile('course-data.js','utf8')+';globalThis.course=COURSE_TOPIC;',context);
      const tracks=context.course.tracks;
      const independent=JSON.parse(await fs.readFile('docs/daodejing-source-directory.json','utf8')).tracks;
      if(independent.length!==107 || new Set(independent.map(item=>item.id)).size!==107) throw new Error('独立来源目录无效');
      if(tracks.length!==107 || new Set(tracks.map(item=>item.id)).size!==107) throw new Error('课程目录必须107个唯一音轨');
      const value=await receipt(required.receipt);
      if(value.checks.length!==107 || new Set(value.checks.map(item=>item.id)).size!==107) throw new Error('媒体回执必须覆盖107个唯一音轨');
      for(const [index,item] of tracks.entries()) {
        const expected=`./public/audio/daodejing/${String(index+1).padStart(3,'0')}.m4a`;
        if(item.audioSrc!==expected || item.mime!=='audio/mp4' || !item.sourceUrl) throw new Error(`目录路径或来源无效 ${item.id}`);
        const source=independent[index];
        if(item.title!==source.title || item.id!==`daodejing-${String(index+1).padStart(3,'0')}`) throw new Error(`独立来源顺序/标题不匹配 ${item.id}`);
        if(index<104 && item.sourceUrl!==`https://www.bilibili.com/video/BV1Vu411y7KM/?p=${index+1}`) throw new Error(`B站分集来源不匹配 ${item.id}`);
        if(index>=104 && !item.sourceUrl.includes(String(source.id))) throw new Error(`官方来源不匹配 ${item.id}`);
        const media=value.checks.find(row=>row.id===item.id);
        const bytes=await fs.readFile(item.audioSrc);
        if(!media || item.sha256!==media.sha256 || item.bytes!==media.bytes || item.fileName!==path.basename(item.audioSrc) || item.privateAudio!==true || media.officialTrackId!==source.id || media.sourceUrl!==item.sourceUrl || !Number.isFinite(item.duration) || item.duration<=0 || !Number.isFinite(media.duration) || media.duration<=0 || !Number.isFinite(media.bytes) || media.bytes<=0 || path.resolve(media.path)!==path.resolve(item.audioSrc) || hash(bytes)!==media.sha256 || bytes.length!==media.bytes || media.decodeExitCode!==0 || Math.abs(media.duration-item.duration)>1) throw new Error(`媒体缺失/损坏/回执过期 ${item.id}`);
      }
      return {tracks:tracks.length,receipt:required.receipt};
    }
    case 'backup': {
      const value=await receipt(required.receipt);
      const manifestPath=path.join(value.destination,'manifest.json');
      const data=await fs.readFile(manifestPath);
      if(hash(data)!==value.manifestSha256 || value.count!==107) throw new Error('备份manifest缺失或过期');
      const saved=JSON.parse(data);
      const media=JSON.parse(await fs.readFile('docs/qa/media-receipt.json','utf8'));
      const publication=await receipt('docs/qa/icloud-publication-check.json');
      if(publication.commandExit!==0 || publication.sha256!==media.checks[0].sha256) throw new Error('真实iCloud文件系统发布证据不匹配');
      if(saved.files.length!==107) throw new Error('备份清单未覆盖107集');
      for(const row of media.checks) {
        const name=path.basename(row.path);
        const recorded=saved.files.find(file=>file.id===row.id);
        if(!recorded || recorded.filename!==name || recorded.sha256!==row.sha256 || recorded.bytes!==row.bytes) throw new Error('备份清单内容不匹配 '+name);
        const backup=await fs.readFile(path.join(value.destination,name));
        if(hash(backup)!==row.sha256 || backup.length!==row.bytes) throw new Error('iCloud本地备份不匹配 '+name);
      }
      return {count:107,destination:value.destination,cloudSync:'unverified',receipt:required.receipt};
    }
    case 'test':
    case 'command': {
      const [command,...args]=required.command.split(' ');
      const result=spawnSync(command,args,{encoding:'utf8'});
      const artifact=path.join(evidence,`${required.id}.log`);
      await fs.writeFile(artifact,`command: ${required.command}\nexit: ${result.status}\n${result.stdout || ''}${result.stderr || ''}`);
      if(result.status!==0) throw new Error(`命令失败 ${required.command}，见 ${artifact}`);
      return {exit:result.status,artifact};
    }
    case 'browser': {
      const value=await receipt(required.receipt); fresh(value);
      for(const scenario of required.scenarios) if(!value.results.some(item=>item.name===scenario && item.pass===true)) throw new Error(`缺少必需场景 ${scenario}`);
      if(!value.results.length || value.results.some(item=>item.pass!==true)) throw new Error('浏览器存在失败结果');
      return {scenarios:value.results.map(item=>item.name),receipt:required.receipt};
    }
    case 'external': {
      const value=await receipt(required.receipt); fresh(value);
      for(const scenario of required.scenarios) if(!value.checks?.some(item=>item.id===scenario && item.status==='pass')) throw new Error(`缺少必需场景 ${scenario}`);
      if(!Array.isArray(value.checks) || !value.checks.length || value.checks.some(item=>item.status!=='pass')) throw new Error('必需环境存在失败/跳过或空检查');
      if(!Array.isArray(value.artifacts) || !value.artifacts.length) throw new Error('缺少验收制品');
      for(const artifact of value.artifacts) if(!(await fs.stat(artifact)).size) throw new Error(`空证据 ${artifact}`);
      return {receipt:required.receipt,artifacts:value.artifacts};
    }
    default: throw new Error(`未知验收种类 ${required.kind}`);
  }
});
const passed=checks.every(item=>item.status==='pass');
await fs.writeFile(path.join(evidence,'acceptance-result.json'),JSON.stringify({status:passed?'pass':'blocked',invocation:'node scripts/acceptance.mjs',sources,checks},null,2));
console.log(JSON.stringify({status:passed?'pass':'blocked',checks},null,2));
process.exitCode=passed?0:1;
