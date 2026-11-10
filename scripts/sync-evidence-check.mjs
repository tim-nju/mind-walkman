import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sandbox = await fs.mkdtemp(path.join(tmpdir(), 'sync-evidence-gate-'));
const manifest = JSON.parse(await fs.readFile('docs/acceptance.json', 'utf8'));
const required = manifest.required.find(check => check.id === 'listening-sync-browser');
const fixture = Buffer.from('{"syntheticContractFixture":true,"notRealBrowserEvidence":true}\n');
try {
  for (const name of manifest.fingerprintFiles) {
    await fs.mkdir(path.dirname(path.join(sandbox, name)), { recursive: true });
    await fs.copyFile(name, path.join(sandbox, name));
  }
  const sources = Object.fromEntries(await Promise.all(manifest.fingerprintFiles.map(async name =>
    [name, hash(await fs.readFile(path.join(sandbox, name)))])));
  const directory = path.dirname(path.join(sandbox, required.receipt));
  await fs.mkdir(directory, { recursive: true });
  const artifactPath = path.join(directory, 'scenario.json');
  const artifact = { path: 'scenario.json', kind: 'json', bytes: fixture.length, sha256: hash(fixture) };
  const baseline = {
    schema: 'browser-evidence/v1', status: 'pass', sources,
    results: required.scenarios.map(name => ({ name, pass: true, artifacts: [artifact] }))
  };
  async function prepare() {
    await fs.writeFile(artifactPath, fixture);
    return structuredClone(baseline);
  }
  async function run(value) {
    await fs.writeFile(path.join(sandbox, required.receipt), JSON.stringify(value));
    const result = spawnSync(process.execPath, ['scripts/acceptance.mjs', '--check', required.id], {
      cwd: sandbox, env: { ...process.env, EVIDENCE_DIR: '.omo/evidence/gate-output' }, encoding: 'utf8'
    });
    assert.equal(result.error, undefined);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.scope, 'partial');
    return { exit: result.status, status: parsed.status, detail: parsed.checks[0].detail };
  }
  assert.equal((await run(await prepare())).status, 'partial-pass');
  console.log('PASS synthetic contract control accepted as partial only');
  const cases = [
    ['missing artifact', async () => { await fs.unlink(artifactPath); }],
    ['same-size tampered artifact', async () => { await fs.writeFile(artifactPath, Buffer.alloc(fixture.length, 32)); }],
    ['failed scenario', async value => { value.results[0].pass = false; }],
    ['stale source', async value => { value.sources['app.js'] = '0'.repeat(64); }],
    ['missing artifact metadata', async value => { value.results[0].artifacts = []; }],
    ['wrong byte length', async value => { value.results[0].artifacts[0].bytes++; }],
    ['relative path escape', async value => { value.results[0].artifacts[0].path = '../scenario.json'; }],
    ['symlink escape', async value => {
      await fs.writeFile(path.join(sandbox, 'outside.json'), fixture);
      await fs.symlink(path.join(sandbox, 'outside.json'), path.join(directory, 'linked.json'));
      value.results[0].artifacts[0].path = 'linked.json';
    }],
    ['JSON claimed as screenshot', async value => { value.results[0].artifacts[0].kind = 'screenshot'; }]
  ];
  for (const [name, attack] of cases) {
    const value = await prepare();
    await attack(value);
    const result = await run(value);
    assert.equal(result.exit, 1, `${name}: gate must block`);
    assert.equal(result.status, 'blocked');
    console.log(`PASS rejects ${name}: ${result.detail}`);
  }
  // Disable the actual production guard only in the isolated copy.
  const ownerPath = path.join(sandbox, 'scripts/acceptance.mjs');
  const owner = await fs.readFile(ownerPath, 'utf8');
  const mutant = owner.replace("if (required.kind === 'browser-evidence')", 'if (false)');
  assert.notEqual(mutant, owner);
  await fs.writeFile(ownerPath, mutant);
  const value = await prepare();
  value.sources['scripts/acceptance.mjs'] = hash(mutant);
  await fs.unlink(artifactPath);
  assert.equal((await run(value)).status, 'partial-pass', 'isolated disabled guard must reproduce missing-evidence acceptance');
  console.log('PASS mutation proves artifact guard owns rejection');
} finally {
  await fs.rm(sandbox, { recursive: true, force: true });
}
