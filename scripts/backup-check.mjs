import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
if (process.argv.length > 2 && (process.argv[2] !== '--output-dir' || !process.argv[3] || process.argv.length !== 4)) {
  throw new Error('Usage: node scripts/backup-check.mjs [--output-dir directory]');
}
const outputDirectory = resolve(process.argv[3] || join(root, 'docs/qa'));
const source = await readFile('scripts/backup-course.mjs', 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const checks = [];
const runs = [];
const temporary = await mkdtemp(join(tmpdir(), 'mw-backup-check-'));
const loader = `import fs from 'node:fs';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const original = { link: fs.promises.link, copy: fs.promises.copyFile, write: fs.promises.writeFile };
const [kind, when] = process.env.MW_BACKUP_POINT.split('-');
const target = kind === 'media' ? '001.m4a' : 'manifest.json';
const matches = file => basename(String(file)) === target;
const stop = () => { fs.writeSync(2, 'INJECTED_PUBLICATION_INTERRUPTION\\n'); process.kill(process.pid, 'SIGKILL'); };
fs.promises.link = async (from, to) => {
  if (matches(to) && when === 'before') stop();
  const result = await original.link(from, to);
  if (matches(to) && when === 'after') stop();
  return result;
};
fs.promises.copyFile = async (from, to, flags) => {
  if (matches(to)) { await original.write(to, Buffer.from('truncated'), { flag: 'wx' }); stop(); }
  return original.copy(from, to, flags);
};
fs.promises.writeFile = async (to, data, options) => {
  if (matches(to)) { await original.write(to, String(data).slice(0, 9), options); stop(); }
  return original.write(to, data, options);
};
syncBuiltinESMExports();
`;

async function fixture(name) {
  const directory = join(temporary, name);
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'docs/qa'), { recursive: true });
  await mkdir(join(directory, 'public/audio/daodejing'), { recursive: true });
  await writeFile(join(directory, 'scripts/backup-course.mjs'), source);
  await writeFile(join(directory, 'interrupt.mjs'), loader);
  const expected = [];
  for (let index = 1; index <= 107; index++) {
    const number = String(index).padStart(3, '0');
    const filename = `${number}.m4a`;
    const bytes = Buffer.from(`fixture-${number}-`.repeat(index + 10));
    await writeFile(join(directory, 'public/audio/daodejing', filename), bytes);
    expected.push({ id: `daodejing-${number}`, path: `./public/audio/daodejing/${filename}`,
      bytes: bytes.length, sha256: digest(bytes), duration: index, decodeExitCode: 0 });
  }
  await writeFile(join(directory, 'docs/qa/media-receipt.json'), JSON.stringify({ status: 'pass', checks: expected }));
  return { directory, expected, destination: join(directory, 'backup') };
}

function run(test, point) {
  const args = point ? ['--import', join(test.directory, 'interrupt.mjs')] : [];
  args.push(join(test.directory, 'scripts/backup-course.mjs'), test.destination);
  const result = spawnSync(process.execPath, args, { cwd: test.directory, encoding: 'utf8',
    timeout: 30000, env: { ...process.env, ...(point ? { MW_BACKUP_POINT: point } : {}) } });
  if (result.error) throw result.error;
  runs.push({ fixture: test.directory, point: point || 'normal', command: [process.execPath, ...args],
    exit: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  return result;
}

async function verifyComplete(test) {
  const manifest = JSON.parse(await readFile(join(test.destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 107);
  assert.deepEqual(manifest.files.map(file => file.id), test.expected.map(file => file.id));
  for (const expected of test.expected) {
    const filename = expected.path.split('/').at(-1);
    const actual = await readFile(join(test.destination, filename));
    assert.equal(digest(actual), expected.sha256, filename);
    assert.equal(actual.length, expected.bytes, filename);
    const row = manifest.files.find(file => file.id === expected.id);
    assert.equal(row.sha256, expected.sha256);
    assert.equal(row.bytes, expected.bytes);
  }
}

async function check(id, action) {
  try { await action(); checks.push({ id, status: 'pass' }); }
  catch (error) { checks.push({ id, status: 'fail', detail: error instanceof Error ? error.message : String(error) }); }
}

try {
  const normal = await fixture('normal');
  await check('normal-copy', async () => {
    const result = run(normal);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).copied, 107);
    await verifyComplete(normal);
  });
  await check('reuse-valid-existing', async () => {
    const result = run(normal);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).reused, 107);
    assert.equal(JSON.parse(result.stdout).copied, 0);
    await verifyComplete(normal);
  });
  await check('reject-corrupt-existing', async () => {
    const file = join(normal.destination, '001.m4a');
    await writeFile(file, 'existing private content');
    const result = run(normal);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Existing backup differs/);
    assert.equal(await readFile(file, 'utf8'), 'existing private content');
  });
  await check('reject-corrupt-source', async () => {
    const test = await fixture('bad-source');
    await writeFile(join(test.directory, 'public/audio/daodejing/001.m4a'), 'corrupted');
    const result = run(test);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source differs/);
    await assert.rejects(readFile(join(test.destination, '001.m4a')), { code: 'ENOENT' });
  });
  for (const kind of ['media', 'manifest']) await check(`resume-${kind}-interruption`, async () => {
    for (const phase of ['before', 'after']) {
      const test = await fixture(`${kind}-${phase}`);
      const interrupted = run(test, `${kind}-${phase}`);
      assert.equal(interrupted.signal, 'SIGKILL');
      assert.match(interrupted.stderr, /INJECTED_PUBLICATION_INTERRUPTION/);
      const resumed = run(test);
      assert.equal(resumed.status, 0, resumed.stderr);
      await verifyComplete(test);
    }
  });
  await check('mutation-rejects-nonatomic', async () => {
    for (const kind of ['media', 'manifest']) {
      const test = await fixture(`mutation-${kind}`);
      const owner = join(test.directory, 'scripts/backup-course.mjs');
      const needle = kind === 'media' ? 'await link(temporary, output);' : 'await link(pendingManifest, manifestPath);';
      const replacement = kind === 'media' ? 'await copyFile(temporary, output, constants.COPYFILE_EXCL);' : "await writeFile(manifestPath, manifestText, { flag: 'wx' });";
      assert.equal(source.split(needle).length, 2, 'Mutation must identify exactly one publication boundary');
      const mutant = source.replace(needle, replacement);
      await writeFile(owner, mutant);
      assert.equal(await readFile(owner, 'utf8'), mutant);
      assert.equal(run(test, `${kind}-before`).signal, 'SIGKILL');
      const resumed = run(test);
      assert.equal(resumed.status, 1, 'Non-atomic publication must fail the same resume invariant');
      assert.match(resumed.stderr, kind === 'media' ? /Existing backup differs/ : /Existing manifest differs/);
      await writeFile(owner, source);
      assert.equal(digest(await readFile(owner)), digest(source));
    }
  });
} finally { await rm(temporary, { recursive: true, force: true }); }

const required = JSON.parse(await readFile('docs/acceptance.json', 'utf8'));
const sources = Object.fromEntries(await Promise.all(required.fingerprintFiles.map(async name => [name, digest(await readFile(name))])));
assert.equal(await readFile('scripts/backup-course.mjs', 'utf8'), source, 'Production owner changed during test');
const status = checks.every(check => check.status === 'pass') ? 'pass' : 'fail';
const results = { status, invocation: ['node', 'scripts/backup-check.mjs', ...process.argv.slice(2)].join(' '), sources, checks, runs,
  scope: 'Real Node CLI with isolated 107-file fixtures; verifies process SIGKILL recovery, not power-loss durability, audio decode or iCloud sync.' };
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'backup-check-results.json'), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(outputDirectory, 'backup-recovery-receipt.json'), `${JSON.stringify({ ...results, runs: undefined,
  artifacts: [join(outputDirectory, 'backup-check-results.json')] }, null, 2)}\n`);
console.log(JSON.stringify({ status, checks }, null, 2));
process.exitCode = status === 'pass' ? 0 : 1;
