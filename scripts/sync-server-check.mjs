import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { database, hash, initialize, issueActivation, approveBackup, revoke } from '../server/db.mjs';
import { httpServer } from '../server/server.mjs';
import { restore } from '../server/restore.mjs';
import { canonical } from '../sync-model.js';

const connection = process.env.SYNC_TEST_DATABASE_URL;
if (!connection) throw new Error('SYNC_TEST_DATABASE_URL_required_use_isolated_postgresql');
const root = fileURLToPath(new URL('../', import.meta.url));
const kit = resolve(process.env.BACKUP_KIT_DIR || join(root, '../经典背诵/packages/backup-kit'));
const { runBackup } = await import(pathToFileURL(join(kit, 'agent.mjs')));
const { parseBackup, createBackup } = await import(pathToFileURL(join(kit, 'envelope.mjs')));
const admin = database(connection), prefix = 'mw_check_' + randomBytes(8).toString('hex');
const schemas = [prefix, prefix+'_restore'];
const pools = [], processes = [], servers = [];
const temporary = await mkdtemp(join(tmpdir(), 'mw-server-check-'));
const origin = 'https://allowed-client.example';
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
function scoped(name) {
  const url = new URL(connection);
  url.searchParams.set('options', '-c search_path='+name);
  return url.href;
}
async function listen(db, options = {}) {
  const server = httpServer({ db, allowedOrigins: [origin], ...options });
  servers.push(server);
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  return { server, url: 'http://127.0.0.1:'+server.address().port };
}
async function request(url, path, { token, body, status = 200, headers = {}, raw } = {}) {
  const response = await fetch(url+path, {
    method: body === undefined && raw === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: 'Bearer '+token } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {})
  });
  const value = await response.json();
  assert.equal(response.status, status, path+': '+JSON.stringify(value));
  checks++;
  return value;
}
async function device(db, url) {
  const token = randomBytes(32).toString('base64url'), activation = await issueActivation(db);
  await request(url, '/api/device/activate', { body: { schema: 1, activationSecret: activation.activationSecret, tokenHash: hash(token) } });
  const bootstrap = await request(url, '/api/device/bootstrap', { token });
  return { token, activation, ...bootstrap };
}
function record(actor, counter, key = 'track:'+randomBytes(32).toString('hex')) {
  return { kind: 'track', key, stamp: { origin: 'live', counter, actor, sample: 0 }, positionMs: counter, furthestMs: counter, durationMs: 5000, completed: false };
}
function operation(actor, counter, key) { return { schema: 1, opId: randomUUID(), actor, record: record(actor,counter,key) }; }
const push = (url, dev, operations, status = 200, sourceId = dev.sourceId) => request(url, '/api/sync/push', { token: dev.token, body: { schema: 1, sourceId, operations }, status });
try {
  for (const name of schemas) await admin.query('CREATE SCHEMA '+name);
  const db = database(scoped(schemas[0])), restored = database(scoped(schemas[1]));
  pools.push(db, restored);
  const initialized = await initialize(db);
  // Exercise upgrading the original schema, whose activation FK blocked rotation.
  await db.query('ALTER TABLE mw_activation ADD CONSTRAINT mw_activation_token_hash_fkey FOREIGN KEY (token_hash) REFERENCES mw_credentials(token_hash)');
  assert.deepEqual(await initialize(db), initialized); checks++;
  let { server, url } = await listen(db);
  const a = await device(db,url), b = await device(db,url);
  const retry = { schema: 1, activationSecret: a.activation.activationSecret, tokenHash: hash(a.token) };
  await request(url,'/api/device/activate',{body:retry});
  await request(url,'/api/device/activate',{body:{...retry,tokenHash:hash(b.token)},status:409});
  const expired = await issueActivation(db);
  await db.query('UPDATE mw_activation SET expires_at=now()-interval \'1 second\' WHERE secret_hash=$1',[hash(expired.activationSecret)]);
  await request(url,'/api/device/activate',{body:{...retry,activationSecret:expired.activationSecret,tokenHash:hash('unassigned')},status:401});
  await request(url,'/api/device/bootstrap',{status:401});
  await request(url,'/api/device/bootstrap',{token:a.token,headers:{origin:'https://evil.example'},status:403});
  await request(url,'/api/device/bootstrap',{token:a.token,headers:{origin},status:200});
  await request(url,'/api/device/bootstrap',{headers:{cookie:'token='+a.token},status:401});
  await request(url,'/api/sync/push',{token:a.token,raw:'{',status:400});
  await request(url,'/api/sync/push',{token:a.token,raw:' '.repeat(256*1024+1),status:413});
  await request(url,'/api/sync/push',{token:a.token,body:{schema:1,sourceId:a.sourceId,operations:[],unknown:true},status:400});
  await push(url,a,[],409,randomUUID());
  await push(url,a,Array.from({length:101},()=>operation(a.actorId,1)),413);
  await push(url,a,[operation(b.actorId,1)],400);
  const ops = Array.from({length:120},(_,i)=>operation(a.actorId,i+1));
  await push(url,a,ops.slice(0,100)); await push(url,a,ops.slice(100));
  const initialSeq = Number((await db.query('SELECT seq FROM mw_owner')).rows[0].seq);
  await push(url,a,[ops[0]]);
  check(Number((await db.query('SELECT seq FROM mw_owner')).rows[0].seq) === initialSeq, 'retry creates no new version');
  await push(url,a,[{...ops[0],record:{...ops[0].record,positionMs:999}}],409);
  const atomic = operation(a.actorId,200);
  await push(url,a,[atomic,{...ops[0],record:{...ops[0].record,positionMs:999}}],409);
  check(!(await db.query('SELECT 1 FROM mw_operations WHERE op_id=$1',[atomic.opId])).rowCount,'failed batch rolls back all operations');
  const malformed = operation(a.actorId,200);
  malformed.record.rawTrackId = 'never-upload';
  await push(url,a,[malformed],400);
  await request(url,'/api/sync/pull?cursor=-1',{token:a.token,status:400});
  await request(url,'/api/sync/pull?cursor=1',{token:a.token,status:409});
  await request(url,'/api/sync/pull?cursor=0&source=wrong',{token:a.token,status:409});
  await request(url,'/api/sync/pull?cursor=0&cursor=1',{token:a.token,status:400});
  await request(url,'/api/sync/pull?cursor=0&through=999999',{token:a.token,status:409});
  const firstPull = await request(url,'/api/sync/pull?cursor=0',{token:a.token});
  check(firstPull.more && firstPull.records.length===100,'pull pages at fixed watermark');
  const tail = await request(url,`/api/sync/pull?cursor=${firstPull.nextCursor}&through=${firstPull.watermark}&source=${a.sourceId}`,{token:a.token});
  check(!tail.more && tail.nextCursor===firstPull.watermark && tail.records.length===20,'pull finishes at watermark');
  const backupToken = randomBytes(32).toString('base64url');
  const pair = await request(url,'/api/backup/pair',{body:{tokenHash:hash(backupToken),label:'Isolated integration test'}});
  await request(url,'/api/backup/export?cursor=0',{token:backupToken,status:401});
  check(!(await request(url,'/api/backup/status',{token:backupToken})).authorized,'pair needs explicit approval');
  await approveBackup(db,pair.code);
  check((await request(url,'/api/backup/status',{token:backupToken})).authorized,'operator approves grant');
  await request(url,'/api/backup/export?cursor=0',{token:a.token,status:401});
  await request(url,'/api/device/bootstrap',{token:backupToken,status:401});
  await request(url,'/api/backup/pair',{body:{tokenHash:hash(a.token),label:'Credential collision'},status:409});
  const firstExport = await request(url,'/api/backup/export?cursor=0',{token:backupToken});
  check(firstExport.more && firstExport.totalCount===120,'backup pages latest versions only');
  const updated = operation(b.actorId,1000,ops[0].record.key);
  await push(url,b,[updated]);
  const laterExport = await request(url,`/api/backup/export?cursor=${firstExport.nextCursor}&through=${firstExport.watermark}&source=${a.sourceId}`,{token:backupToken});
  check(!laterExport.more && laterExport.nextCursor===firstExport.watermark && laterExport.totalCount===120,'export watermark survives concurrent writes');
  assert.deepEqual(laterExport.payloadHeader,firstExport.payloadHeader); checks++;
  const fixed = [...firstExport.records,...laterExport.records];
  assert.deepEqual(fixed.find(r=>r.key===ops[0].record.key),ops[0].record); checks++;
  // Two HTTP callers use independent PostgreSQL pool clients against the same owner.
  const concurrent = Array.from({length:20},(_,i)=>operation(i%2 ? a.actorId : b.actorId,2000+i));
  await Promise.all(concurrent.map((op,i)=>push(url,i%2 ? a : b,[op])));
  const versions = (await db.query('SELECT seq FROM mw_versions ORDER BY seq')).rows.map(x=>Number(x.seq));
  check(versions.every((seq,i)=>seq===i+1),'concurrent commits keep contiguous ordered sequence');
  const duplicate = operation(a.actorId,3000);
  await Promise.all([push(url,a,[duplicate]),push(url,a,[duplicate])]);
  check(Number((await db.query('SELECT count(*) AS n FROM mw_operations WHERE op_id=$1',[duplicate.opId])).rows[0].n)===1,'concurrent duplicate stored once');
  const expected = await request(url,'/api/sync/pull?cursor=0',{token:a.token});
  await new Promise(resolveClose=>server.close(resolveClose));
  await db.end(); pools.splice(pools.indexOf(db),1);
  // Start a fresh executable Node process and fresh pool, proving restart persistence.
  const persisted = database(scoped(schemas[0])); pools.push(persisted);
  const probe = await listen(persisted);
  const port = probe.server.address().port;
  await new Promise(resolveClose=>probe.server.close(resolveClose));
  const child = spawn(process.execPath,['server/server.mjs'],{
    cwd:root,env:{...process.env,DATABASE_URL:scoped(schemas[0]),ALLOWED_ORIGINS:origin,HOST:'127.0.0.1',PORT:String(port)},
    stdio:['ignore','pipe','pipe']
  });
  processes.push(child);
  await new Promise((ready,reject)=>{
    const timer=setTimeout(()=>reject(new Error('restart_timeout')),15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('restart_exit_'+code));});
    child.stdout.on('data',chunk=>{if(String(chunk).includes('sync_server_listening')){clearTimeout(timer);ready();}});
  });
  url='http://127.0.0.1:'+port;
  assert.deepEqual(await request(url,'/api/sync/pull?cursor=0',{token:a.token}),expected); checks++;
  assert.deepEqual(await request(url,'/api/device/bootstrap',{token:a.token}),{schema:1,actorId:a.actorId,sourceId:a.sourceId,trackKeySecret:a.trackKeySecret}); checks++;
  // Real installed backup-kit runner writes, reads back and validates its envelope.
  const result = await runBackup({config:{origin:url,projectId:'mind-walkman',directory:join(temporary,'snapshots')},token:backupToken});
  const envelope = await parseBackup(await readFile(result.path,'utf8'),{projectId:'mind-walkman'});
  check(envelope.payload.records.length===141 && envelope.payload.trackKeySecret===a.trackKeySecret,'backup-kit envelope roundtrip');
  await request(url,'/api/backup/receipt',{token:backupToken,body:{savedAt:result.savedAt,checksum:result.checksum}});
  const restoreResult=await restore(restored,result.path);
  check(restoreResult.sourceId!==a.sourceId && restoreResult.reauthorizationRequired,'restore creates new source without credentials');
  check(Number((await restored.query('SELECT count(*) AS n FROM mw_credentials')).rows[0].n)===0,'restore imports no credentials');
  check((await restored.query('SELECT track_key_secret FROM mw_owner')).rows[0].track_key_secret===a.trackKeySecret,'restore preserves HMAC identity');
  const restoredRecords=(await restored.query('SELECT record FROM mw_versions')).rows.map(x=>canonical(x.record)).sort();
  assert.deepEqual(restoredRecords,envelope.payload.records.map(canonical).sort()); checks++;
  await assert.rejects(restore(restored,result.path),/restore_requires_empty_database/); checks++;
  const tampered=join(temporary,'tampered.json');
  await writeFile(tampered,JSON.stringify({...envelope,checksum:'0'.repeat(64)}));
  await assert.rejects(restore(restored,tampered),/checksum/); checks++;
  const invalidEnvelope=await createBackup({...envelope,payload:{...envelope.payload,records:[{...envelope.payload.records[0],rawId:'private'}]}});
  await writeFile(tampered,JSON.stringify(invalidEnvelope));
  await assert.rejects(restore(restored,tampered)); checks++;
  const restoredHTTP=await listen(restored);
  await request(restoredHTTP.url,'/api/device/bootstrap',{token:a.token,status:401});
  const restoredDevice=await device(restored,restoredHTTP.url);
  await push(restoredHTTP.url,restoredDevice,[],409,a.sourceId);
  await revoke(persisted,pair.id);
  await request(url,'/api/backup/export?cursor=0',{token:backupToken,status:401});
  const pending = operation(a.actorId,4000);
  await request(url,'/api/device/disconnect',{token:a.token,body:{}});
  await request(url,'/api/device/bootstrap',{token:a.token,status:401});
  await request(url,'/api/device/activate',{body:retry,status:401});
  await push(url,a,[pending],401);
  const rotationSecret = await issueActivation(persisted);
  const nextToken = randomBytes(32).toString('base64url');
  const rotation = { schema:1, activationSecret:rotationSecret.activationSecret, tokenHash:hash(nextToken) };
  const rotationBackupToken = randomBytes(32).toString('base64url');
  const rotationPair = await request(url,'/api/backup/pair',{body:{tokenHash:hash(rotationBackupToken),label:'Rotation purpose isolation'}});
  await approveBackup(persisted,rotationPair.code);
  await request(url,'/api/device/activate',{token:randomBytes(32).toString('base64url'),body:rotation,status:401});
  await request(url,'/api/device/activate',{token:rotationBackupToken,body:rotation,status:401});
  await request(url,'/api/device/activate',{headers:{authorization:'Bearer malformed'},body:rotation,status:401});
  const expiredRotation = await issueActivation(persisted);
  await persisted.query('UPDATE mw_activation SET expires_at=now()-interval \'1 second\' WHERE secret_hash=$1',[hash(expiredRotation.activationSecret)]);
  await request(url,'/api/device/activate',{token:a.token,body:{...rotation,activationSecret:expiredRotation.activationSecret},status:401});
  await request(url,'/api/device/activate',{token:a.token,body:{...rotation,activationSecret:a.activation.activationSecret},status:409});
  await request(url,'/api/device/activate',{token:a.token,body:{...rotation,tokenHash:hash(b.token)},status:409});
  await request(url,'/api/device/activate',{token:a.token,body:{...rotation,tokenHash:hash(a.token)},status:409});
  check((await persisted.query('SELECT token_hash FROM mw_activation WHERE secret_hash=$1',[hash(rotationSecret.activationSecret)])).rows[0].token_hash===null,'rejected rotation does not consume fresh activation');
  const beforeRotation = (await persisted.query('SELECT count(*) AS n FROM mw_credentials')).rows[0].n;
  await Promise.all([
    request(url,'/api/device/activate',{token:a.token,body:rotation}),
    request(url,'/api/device/activate',{token:a.token,body:rotation})
  ]);
  const rotated = {...a,token:nextToken};
  assert.deepEqual(await request(url,'/api/device/bootstrap',{token:nextToken}),{
    schema:1,actorId:a.actorId,sourceId:a.sourceId,trackKeySecret:a.trackKeySecret
  }); checks++;
  check((await persisted.query('SELECT count(*) AS n FROM mw_credentials')).rows[0].n===beforeRotation,'rotation updates existing credential instead of creating another actor');
  await request(url,'/api/device/bootstrap',{token:a.token,status:401});
  await push(url,a,[pending],401);
  const acknowledged = await push(url,rotated,[ops[0],pending]);
  assert.deepEqual(acknowledged.acknowledged,[ops[0].opId,pending.opId]); checks++;
  check((await persisted.query('SELECT body FROM mw_operations WHERE op_id=$1',[pending.opId])).rows[0].body===canonical(pending),'pre-rotation pending operation preserves its actor and content');
  await request(url,'/api/device/activate',{body:rotation});
  await request(url,'/api/device/activate',{body:retry,status:401});
  await request(url,'/api/device/activate',{token:a.token,body:{...retry,tokenHash:hash(nextToken)},status:409});
  const reused = await issueActivation(persisted);
  await request(url,'/api/device/activate',{token:a.token,body:{schema:1,activationSecret:reused.activationSecret,tokenHash:hash(randomBytes(32).toString('base64url'))},status:401});
  await request(url,'/api/device/activate',{token:nextToken,body:{schema:1,activationSecret:reused.activationSecret,tokenHash:hash(a.token)},status:409});
  await request(url,'/api/device/activate',{body:{schema:1,activationSecret:reused.activationSecret,tokenHash:hash(a.token)},status:409});
  await request(url,'/api/device/disconnect',{token:nextToken,body:{}});
  await request(url,'/api/device/activate',{token:nextToken,body:rotation,status:401});
  await request(url,'/api/device/activate',{body:rotation,status:401});
  await request(url,'/api/device/activate',{token:nextToken,body:{...rotation,tokenHash:hash(randomBytes(32).toString('base64url'))},status:409});
  await request(url,'/api/device/bootstrap',{token:nextToken,status:401});
  const limited=await listen(persisted,{rateLimit:1,activationLimit:1});
  await request(limited.url,'/api/device/bootstrap',{token:b.token});
  await request(limited.url,'/api/device/bootstrap',{token:b.token,status:429});
  await request(limited.url,'/api/backup/pair',{body:{tokenHash:hash('rate-test'),label:'Rate test'}});
  await request(limited.url,'/api/backup/pair',{body:{tokenHash:hash('rate-test-2'),label:'Rate test'},status:429});
  // Exercise operator executable with an explicit connection selection and redacted listing.
  const cli=spawn(process.execPath,['server/admin.mjs','list','--database-env','MW_ISOLATED_ADMIN'],{cwd:root,env:{...process.env,MW_ISOLATED_ADMIN:scoped(schemas[0])},stdio:['ignore','pipe','pipe']});
  let listing='';cli.stdout.on('data',x=>listing+=x);
  const [exit]=await once(cli,'exit');
  check(exit===0 && JSON.parse(listing).credentials.length>=3 && !listing.includes(a.token) && !listing.includes(hash(a.token)),'operator CLI works without credential disclosure');
  console.log(JSON.stringify({passed:true,checks,postgres:true,authenticatedHTTP:true,concurrentWrites:true,restartPersistence:true,backupKitRoundtrip:true,isolatedRestore:true,actorPreservingRotation:true}));
} finally {
  for (const child of processes) if (child.exitCode===null) { const exited=once(child,'exit'); child.kill('SIGTERM'); await exited; }
  for (const server of servers) if (server.listening) await new Promise(resolveClose=>server.close(resolveClose));
  for (const pool of pools) await pool.end();
  for (const name of schemas) await admin.query('DROP SCHEMA IF EXISTS '+name+' CASCADE');
  await admin.end();
  await rm(temporary,{recursive:true,force:true});
}
