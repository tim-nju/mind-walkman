import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const output = path.resolve('.omo/evidence/hope/gate-injection');
await fs.mkdir(output, { recursive: true });
const isolated = await fs.mkdtemp('/private/tmp/hope-release.9IHTLq/executor-st01a1bbfd/gate-');
const checks = [];
try {
  // Private media stays local. Only the injected episode is copied; shared courses are read-only.
  for (const name of ['scripts', 'docs', 'app.js', 'controls.js', 'storage.js', 'sw.js', 'index.html', 'styles.css', 'tracks.js', 'course-data.js', 'manifest.json', 'importer.js']) {
    await fs.cp(path.join(root, name), path.join(isolated, name), { recursive: true });
  }
  await fs.mkdir(path.join(isolated, 'public/audio/hope'), { recursive: true });
  await fs.symlink(path.join(root, 'public/audio/daodejing'), path.join(isolated, 'public/audio/daodejing'));
  const mediaPath = path.join(isolated, 'public/audio/hope/hope-workplace-03.mp3');
  const original = await fs.readFile('public/audio/hope/hope-workplace-03.mp3');
  await fs.writeFile(mediaPath, original);
  await fs.mkdir(path.join(isolated, '.omo/evidence/hope'), { recursive: true });
  const receiptPath = path.join(isolated, '.omo/evidence/hope/import-results.json');
  const validReceipt = await fs.readFile('.omo/evidence/hope/import-results.json', 'utf8');
  await fs.writeFile(receiptPath, validReceipt);
  async function reject(name, id, reason) {
    const result = spawnSync(process.execPath, ['scripts/acceptance.mjs'], { cwd: isolated, env: { ...process.env, EVIDENCE_DIR: path.join(output, name) }, encoding: 'utf8' });
    await fs.writeFile(path.join(output, `${name}.log`), `exit: ${result.status}\n${result.stdout}${result.stderr}`);
    const gate = JSON.parse(await fs.readFile(path.join(output, name, 'acceptance-result.json'), 'utf8'));
    const check = gate.checks.find(item => item.id === id);
    assert.equal(result.status, 1);
    assert.equal(check.status, 'fail');
    assert.match(check.detail, reason);
    checks.push({ name, exit: result.status, rejected: id, detail: check.detail });
    console.log(`PASS gate rejects ${name}: ${check.detail}`);
  }
  const damaged = Buffer.from(original);
  damaged[1024] ^= 255;
  await fs.writeFile(mediaPath, damaged);
  await reject('broken-episode', 'hope-source-media', /命令失败/);
  const mediaLog = await fs.readFile(path.join(output, 'broken-episode/hope-source-media.log'), 'utf8');
  assert.match(mediaLog, /Official single-episode media SHA mismatch/);
  await fs.writeFile(mediaPath, original);
  await fs.writeFile(receiptPath, JSON.stringify({ status: 'fail', reason: 'injected failed evidence' }));
  await reject('failed-evidence', 'hope-file-import', /injected failed evidence/);
  await fs.writeFile(receiptPath, JSON.stringify({ ...JSON.parse(validReceipt), sources: {} }));
  await reject('stale-evidence', 'hope-file-import', /过期或缺少源码指纹/);
} finally {
  await fs.rm(isolated, { recursive: true, force: true });
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ status: checks.length === 3 ? 'pass' : 'fail', checks }, null, 2));
}
