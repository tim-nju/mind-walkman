import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const handlers = new Map();
const context = vm.createContext({ Request, Response, URL, Error, caches:{ match:async () => new Response(Uint8Array.from([0,1,2,3,4,5]),{headers:{'content-type':'audio/mp4'}}) }, self:{addEventListener:(name,callback)=>handlers.set(name,callback),location:{origin:'http://localhost'}}, fetch:async()=>{throw new Error('offline');} });
vm.runInContext(readFileSync('sw.js','utf8'),context);
for (const [range,status,body,contentRange] of [['bytes=1-3',206,[1,2,3],'bytes 1-3/6'],['bytes=-2',206,[4,5],'bytes 4-5/6'],['bytes=4-99',206,[4,5],'bytes 4-5/6'],['bytes=8-',416,[],'bytes */6'],['bytes=3-1',416,[],'bytes */6'],['bytes=-0',416,[],'bytes */6']]) {
  let response;
  handlers.get('fetch')({request:new Request('http://localhost/audio.m4a',{headers:{range}}),respondWith:value=>{response=value;}});
  const result=await response;
  assert.equal(result.status,status,range);
  assert.equal(result.headers.get('content-range'),contentRange,range);
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],body,range);
  if(status===206) assert.equal(result.headers.get('content-type'),'audio/mp4');
  console.log(`PASS ${range} ${status} ${contentRange}`);
}
context.self.location.origin='https://tim-nju.github.io';
context.caches.match=async()=>undefined;
let networkUsed=false;
context.fetch=async()=>{networkUsed=true;return new Response('unexpected network');};
for (const file of ['daodejing/001.m4a', 'hope/hope-workplace-03.mp3', 'scripture/mw230903.mp3', 'diamond/diamond-shengyen-01.mp3']) {
  let privateResponse;
  handlers.get('fetch')({request:new Request(`https://tim-nju.github.io/mind-walkman/public/audio/${file}`),respondWith:value=>{privateResponse=value;}});
  assert.equal((await privateResponse).status,404);
}
assert.equal(networkUsed,false);
console.log('PASS public missing private media never reaches network');

// Browser HTTP cache may still hold the previous release at unversioned URLs.
// Assert the platform cache-mode contract at the real worker install boundary.
const installRequests=[];
context.Request=class extends Request {
  constructor(input, options) { super(new URL(input,'https://example.test/player/'),options); }
};
context.caches.open=async()=>({addAll:async requests=>installRequests.push(...requests)});
context.self.skipWaiting=async()=>{};
let installation;
handlers.get('install')({waitUntil:value=>{installation=value;}});
await installation;
assert.ok(installRequests.length>0);
for(const request of installRequests) {
  assert.ok(request instanceof Request,'install must declare the HTTP cache policy');
  assert.equal(request.cache,'reload','new shell must bypass stale HTTP cache');
}
console.log('PASS install bypasses old HTTP cache for every shell resource');
