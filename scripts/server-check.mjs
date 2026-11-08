import assert from 'node:assert/strict';
const origin = process.env.PLAYER_URL || 'http://127.0.0.1:8767';
for(const resource of ['/docs/技术架构.md','/.git/config','/public/audio/..%2f..%2f.git/config','/public/audio/..%2f..%2fdocs/技术架构.md']) {
  const response=await fetch(`${origin}${resource}`);
  assert.equal(response.status,403,resource);
  console.log(`PASS private path denied ${response.status} ${resource}`);
}
const response=await fetch(`${origin}/public/audio/daodejing/002.m4a`,{headers:{Range:'bytes=0-31'}});
assert.equal(response.status,206);
assert.equal(response.headers.get('content-type'),'audio/mp4');
assert.equal((await response.arrayBuffer()).byteLength,32);
console.log(`PASS actual media range 206 ${response.headers.get('content-range')} audio/mp4 32 bytes`);
