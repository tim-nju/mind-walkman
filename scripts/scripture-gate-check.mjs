import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd();
const output = path.resolve('.omo/evidence/scripture');
await fs.mkdir(output, { recursive: true });
const isolated = await fs.mkdtemp(path.join(tmpdir(), 'scripture-gate-'));
const manifest = JSON.parse(await fs.readFile('docs/acceptance.json', 'utf8'));
const sources = Object.fromEntries(await Promise.all(manifest.fingerprintFiles.map(async name => [name, createHash('sha256').update(await fs.readFile(name)).digest('hex')])));
const checks = [];
const artifacts = [];
try {
  for (const name of ['scripts', 'docs', '.git', 'app.js', 'controls.js', 'storage.js', 'sw.js', 'index.html', 'styles.css', 'tracks.js', 'course-data.js', 'manifest.json', 'importer.js']) {
    await fs.cp(path.join(root, name), path.join(isolated, name), { recursive: true });
  }
  await fs.mkdir(path.join(isolated, 'public/audio/scripture'), { recursive: true });
  for (const name of ['daodejing', 'hope', 'diamond']) await fs.symlink(path.join(root, 'public/audio', name), path.join(isolated, 'public/audio', name));
  for (const name of ['mw200810.mp3', 'mw200614.mp3']) await fs.symlink(path.join(root, 'public/audio/scripture', name), path.join(isolated, 'public/audio/scripture', name));
  const mediaPath = path.join(isolated, 'public/audio/scripture/mw230903.mp3');
  const original = await fs.readFile('public/audio/scripture/mw230903.mp3');
  await fs.mkdir(path.join(isolated, '.omo/evidence/scripture'), { recursive: true });
  const receiptPath = path.join(isolated, '.omo/evidence/scripture/import-results.json');
  const validReceipt = await fs.readFile('.omo/evidence/scripture/import-results.json', 'utf8');
  await fs.writeFile(receiptPath, validReceipt);
  async function reject(scenario) {
    const result = spawnSync(process.execPath, ['scripts/acceptance.mjs'], { cwd: isolated, env: { ...process.env, EVIDENCE_DIR: path.join(output, scenario.name) }, encoding: 'utf8' });
    const log = path.join(output, `${scenario.name}.log`);
    await fs.writeFile(log, `command: node scripts/acceptance.mjs\nexit: ${result.status}\n${result.stdout}${result.stderr}`);
    artifacts.push(log);
    const gate = JSON.parse(await fs.readFile(path.join(output, scenario.name, 'acceptance-result.json'), 'utf8'));
    const check = gate.checks.find(item => item.id === scenario.gate);
    assert.equal(result.status, 1);
    assert.equal(check.status, 'fail');
    assert.match(check.detail, scenario.reason);
    checks.push({ id: scenario.name, status: 'pass', rejected: scenario.gate, exit: result.status, detail: check.detail });
    console.log(`PASS ${scenario.name}: ${check.detail}`);
  }
  const damaged = Buffer.from(original); damaged[1024] ^= 255;
  await fs.writeFile(mediaPath, damaged);
  await reject({ name: 'corrupt-media-rejected', gate: 'scripture-source-media', reason: /命令失败/ });
  assert.match(await fs.readFile(path.join(output, 'corrupt-media-rejected/scripture-source-media.log'), 'utf8'), /Private media SHA mismatch/);
  await fs.writeFile(mediaPath, original);
  await fs.writeFile(receiptPath, JSON.stringify({ status: 'fail', reason: 'injected failed scripture evidence' }));
  await reject({ name: 'failed-evidence-rejected', gate: 'scripture-file-import', reason: /injected failed scripture evidence/ });
  await fs.writeFile(receiptPath, JSON.stringify({ ...JSON.parse(validReceipt), sources: {} }));
  await reject({ name: 'stale-evidence-rejected', gate: 'scripture-file-import', reason: /过期或缺少源码指纹/ });
} finally {
  await fs.rm(isolated, { recursive: true, force: true });
  await fs.writeFile(path.join(output, 'gate-results.json'), JSON.stringify({ status: checks.length === 3 ? 'pass' : 'fail', sources, checks, artifacts }, null, 2));
}
