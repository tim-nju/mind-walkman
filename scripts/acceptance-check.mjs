import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const hash = data => createHash('sha256').update(data).digest('hex');
const root = process.cwd();
const sandbox = await fs.mkdtemp(path.join(tmpdir(), 'private-evidence-gate-'));
const manifest = JSON.parse(await fs.readFile('docs/acceptance.json', 'utf8'));
const required = manifest.required.find(row => row.id === 'private-recording-candidate');
const results = [];
try {
  for (const name of manifest.fingerprintFiles) {
    await fs.mkdir(path.dirname(path.join(sandbox, name)), { recursive: true });
    await fs.copyFile(name, path.join(sandbox, name));
  }
  const sources = Object.fromEntries(await Promise.all(manifest.fingerprintFiles.map(async name =>
    [name, hash(await fs.readFile(path.join(sandbox, name)))])));
  const media = [];
  for (const role of ['original', 'candidate', 'catalog']) {
    const filename = `fixture-${role}`;
    const bytes = Buffer.from(`synthetic-${role}`);
    await fs.writeFile(path.join(sandbox, filename), bytes);
    media.push({ role, path: filename, bytes: bytes.length, sha256: hash(bytes) });
  }
  const catalogBytes = JSON.stringify([{ fileName: media[1].path, bytes: media[1].bytes, sha256: media[1].sha256, duration: 100 }]);
  await fs.writeFile(path.join(sandbox, media[2].path), catalogBytes);
  media[2] = { ...media[2], bytes: Buffer.byteLength(catalogBytes), sha256: hash(catalogBytes) };
  const validationBytes = JSON.stringify({ status: 'LOCAL_MEDIA_VALIDATED',
    source: { beforeSHA256: media[0].sha256, afterSHA256: media[0].sha256, bytes: media[0].bytes },
    candidate: { sha256: media[1].sha256, bytes: media[1].bytes },
    exits: { 'repaired-decode': 0, transcode: 0, 'candidate-decode': 0 } });
  await fs.writeFile(path.join(sandbox, 'media-validation.json'), validationBytes);
  const log = Buffer.from('SYNTHETIC CONTRACT FIXTURE; not acceptance evidence\n');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(sandbox, 'run.log'), log);
  await fs.writeFile(path.join(sandbox, 'shot.png'), png);
  const artifacts = [{ kind: 'log', path: 'run.log', sha256: hash(log) }, { kind: 'screenshot', path: 'shot.png', sha256: hash(png) }];
  const observations = [
    { catalogChosen: true, audioChosen: true, importedBytes: media[1].bytes, duration: 100 },
    Object.fromEntries(['collisionRejectedBeforeWrite', 'oldMetadataAndAudioRetained', 'mergedTracksRetained',
      'duplicateRejected', 'pathRejected', 'quotaVisible', 'securityVisible', 'malformedPreserved',
      'malformedRecovered', 'sameSizeCorruptionRejected'].map(key => [key, true])),
    { duration: 100, playStart: 0, playEnd: 1, nearEndStart: 70, nearEndEnd: 71, resumeTime: 71,
      offlineStart: 71, offlineEnd: 72, serverStopped: true, browserRestarted: true },
    { originalBytes: 123, courseTracks: 107, hopeTracks: 1, bookmarkBefore: 12, bookmarkAfter: 12 },
    { catalogStatus: 403, mediaStatus: 403 },
    { systemFiles: true, offlineColdReopen: true, downstreamRead: true, playStart: 0, playEnd: 1, offlineStart: 1, offlineEnd: 2 },
    { taskId: 'st_synthetic', coverage: 'pass', code: 'pass', architecture: 'pass', visual: 'pass' },
    { fromVersion: 11, toVersion: 12, oldAudioBytes: 123, newAudioBytes: 123, bookmarkBefore: 12,
      bookmarkAfter: 12, controller: 'http://localhost/sw.js?v=12', offlineStart: 12, offlineEnd: 13 }
  ];
  const reports = required.scenarios.map((id, index) => ({
    schema: 'private-recording-scenario/v1', scenario: id, status: 'pass', sources, media,
    runtime: { engine: index === 5 ? 'ios-simulator' : index === 6 ? 'native-reviewer' : 'synthetic-browser', version: 'fixture' },
    command: { argv: ['synthetic-contract-control'], exitCode: 0 }, observations: observations[index], artifacts
  }));
  const final = { schema: 'private-recording-final/v1', status: 'pass', sources, media,
    mediaValidation: { path: 'media-validation.json', sha256: hash(validationBytes) }, checks: [] };
  async function prepare() {
    await fs.mkdir(path.join(sandbox, '.omo/evidence'), { recursive: true });
    final.checks = [];
    for (const [index, report] of reports.entries()) {
      const file = `scenario-${index}.json`;
      const bytes = JSON.stringify(report);
      await fs.writeFile(path.join(sandbox, file), bytes);
      final.checks.push({ id: report.scenario, status: 'pass', evidence: { path: file, sha256: hash(bytes) } });
    }
    await fs.writeFile(path.join(sandbox, required.receipt), JSON.stringify(final));
  }
  function run() {
    const result = spawnSync(process.execPath, ['scripts/acceptance.mjs', '--check', required.id], {
      cwd: sandbox, env: { ...process.env, EVIDENCE_DIR: '.omo/evidence/diagnostic' }, encoding: 'utf8'
    });
    assert.equal(result.error, undefined);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.scope, 'partial');
    assert.equal(receipt.checks.length, 1);
    assert.equal(receipt.checks[0].id, required.id);
    return { exit: result.status, status: receipt.status, check: receipt.checks[0] };
  }
  await prepare();
  assert.equal(run().status, 'partial-pass');
  results.push({ name: 'typed synthetic control accepted only as partial', pass: true });
  const attacks = [
    ['arbitrary prose artifact', async () => {
      const prose = 'Any architecture prose is not scenario evidence';
      await fs.writeFile(path.join(sandbox, 'prose.md'), prose);
      final.artifacts = ['prose.md'];
      final.checks[0].evidence = { path: 'prose.md', sha256: hash(prose) };
    }],
    ['missing scenario', async () => { final.checks.pop(); }],
    ['failed scenario', async () => { final.checks[0].status = 'fail'; }],
    ['stale final source', async () => { final.sources = { ...sources, 'app.js': '0'.repeat(64) }; }],
    ['stale report source', async () => {
      const changed = { ...reports[0], sources: { ...sources, 'app.js': '0'.repeat(64) } };
      const bytes = JSON.stringify(changed);
      await fs.writeFile(path.join(sandbox, 'scenario-0.json'), bytes);
      final.checks[0].evidence.sha256 = hash(bytes);
    }],
    ['stale final media', async () => { await fs.appendFile(path.join(sandbox, media[1].path), 'changed'); }],
    ['tampered screenshot', async () => { await fs.appendFile(path.join(sandbox, 'shot.png'), 'changed'); }],
    ['same-size corruption not rejected', async () => {
      const changed = { ...reports[1], observations: { ...reports[1].observations, sameSizeCorruptionRejected: false } };
      const bytes = JSON.stringify(changed);
      await fs.writeFile(path.join(sandbox, 'scenario-1.json'), bytes);
      final.checks[1].evidence.sha256 = hash(bytes);
    }],
    ['desktop relabeled as iOS', async () => {
      const bytes = JSON.stringify({ ...reports[5], runtime: { engine: 'chrome', version: 'fixture' } });
      await fs.writeFile(path.join(sandbox, 'scenario-5.json'), bytes);
      final.checks[5].evidence.sha256 = hash(bytes);
    }]
  ];
  for (const [name, attack] of attacks) {
    final.sources = sources;
    await fs.writeFile(path.join(sandbox, media[1].path), 'synthetic-candidate');
    await fs.writeFile(path.join(sandbox, 'shot.png'), png);
    await prepare(); await attack();
    await fs.writeFile(path.join(sandbox, required.receipt), JSON.stringify(final));
    const result = run();
    assert.equal(result.exit, 1, `${name}: actual gate accepted invalid evidence`);
    assert.equal(result.check.status, 'fail');
    results.push({ name, pass: true, actualExit: result.exit, reason: result.check.detail });
  }
  // Reintroduce the exact original weak predicate only in the isolated gate copy.
  final.sources = sources; await prepare();
  final.artifacts = ['run.log'];
  await fs.writeFile(path.join(sandbox, required.receipt), JSON.stringify(final));
  const owner = await fs.readFile(path.join(sandbox, 'scripts/acceptance.mjs'), 'utf8');
  const mutant = owner.replace("if (required.id === 'private-recording-candidate') return validatePrivateRecording(value, required, sources);", '');
  assert.notEqual(mutant, owner);
  await fs.writeFile(path.join(sandbox, 'scripts/acceptance.mjs'), mutant);
  final.sources = { ...sources, 'scripts/acceptance.mjs': hash(mutant) };
  delete final.schema;
  await fs.writeFile(path.join(sandbox, required.receipt), JSON.stringify(final));
  assert.equal(run().status, 'partial-pass', 'weak predicate control must reproduce false acceptance');
  results.push({ name: 'original weak predicate accepts unrelated nonempty log in isolated mutant', pass: true });
  console.log(JSON.stringify({ status: 'pass', results }, null, 2));
} finally {
  await fs.rm(sandbox, { recursive: true, force: true });
}
