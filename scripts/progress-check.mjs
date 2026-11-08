import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('app.js','utf8');
const functions=source.slice(source.indexOf('function readProgress'),source.indexOf('function renderList'));
const data=new Map();const nodes=[];
const events={};
const c=vm.createContext({localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},
track:{id:'t',duration:100}, ORIGINAL_TRACK:{id:'original',duration:200},
audio:{currentTime:0,duration:100,ended:false},sourceReady:true,allTracks:[],byId:()=>({querySelectorAll:()=>nodes}),cacheKeys:new Set(),formatTime:x=>String(x),console});
vm.runInContext(functions,c);
const get=()=>vm.runInContext('progressLabel(track)',c);
let count=0;const check=(name,fn)=>{data.clear();Object.assign(c.audio,{currentTime:0,duration:100,ended:false});c.sourceReady=true;fn();console.log('PASS '+name);count++};
check('fresh 0',()=>assert.equal(get(),'已听 0%'));
check('legacy 50',()=>{data.set('mw_pos_t','50');assert.equal(get(),'已听 50%')});
for(const bad of ['{','{}','[]','{"furthest":-1}','{"furthest":"50"}'])check('corrupt fallback '+bad,()=>{data.set('mw_pos_t','50');data.set('mw_progress_t',bad);assert.equal(get(),'已听 50%')});
check('invalid bookmark',()=>{data.set('mw_pos_t','NaN');assert.equal(get(),'已听 0%')});
check('reserve 100 for end',()=>{c.audio.currentTime=99.999;c.savePosition();assert.equal(get(),'已听 99%')});
check('ended persists completion, resets resume',()=>{Object.assign(c.audio,{currentTime:100,ended:true});c.savePosition();assert.equal(get(),'已听 100% · 已听完');assert.equal(data.get('mw_pos_t'),'0')});
check('replay keeps completed',()=>{Object.assign(c.audio,{currentTime:100,ended:true});c.savePosition();Object.assign(c.audio,{currentTime:3,ended:false});c.savePosition();assert.equal(get(),'已听 100% · 已听完');assert.equal(data.get('mw_pos_t'),'3')});
check('backward seek keeps furthest',()=>{c.audio.currentTime=70;c.savePosition();c.audio.currentTime=20;c.savePosition();assert.equal(get(),'已听 70%')});
check('metadata-loading guard',()=>{data.set('mw_pos_t','50');c.sourceReady=false;c.savePosition();assert.equal(data.get('mw_pos_t'),'50');assert.equal(data.has('mw_progress_t'),false)});
check('actual duration wins',()=>{Object.assign(c.audio,{duration:200,currentTime:100});c.savePosition();assert.equal(get(),'已听 50%')});
check('unknown duration',()=>{assert.equal(c.progressLabel({id:'u',duration:0}),'进度未知');assert.equal(c.progressLabel({id:'u',duration:Infinity}),'进度未知')});
check('nonfinite position ignored',()=>{c.audio.currentTime=Infinity;c.savePosition();assert.equal(data.size,0)});
check('original legacy migration',()=>{data.set('mw_pos','100');assert.equal(c.progressLabel(c.ORIGINAL_TRACK),'已听 50%')});
check('old cleared zero not invented completion',()=>{data.set('mw_pos_t','0');assert.equal(get(),'已听 0%')});
console.log(`${count} checks passed`);
