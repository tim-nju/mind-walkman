import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2];
const singleEpisode = process.argv[3] === '--hope';
if (!destination || process.argv.length > 4 || (process.argv[3] && !singleEpisode)) throw new Error('Usage: node scripts/backup-course.mjs <destination-directory> [--hope]');
const target = resolve(destination);
const receipt = JSON.parse(await readFile(resolve(root, singleEpisode ? 'docs/qa/hope-media-receipt.json' : 'docs/qa/media-receipt.json'), 'utf8'));
const expectedCount = singleEpisode ? 1 : 107;
if (receipt.status !== 'pass' || receipt.checks.length !== expectedCount) throw new Error(`Validated ${expectedCount}-track receipt required`);

async function inspect(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${path}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return { bytes: stat.size, sha256: digest.digest('hex') };
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function matches(actual, expected) {
  return actual.bytes === expected.bytes && actual.sha256 === expected.sha256;
}

await mkdir(target, { recursive: true });
if (!(await lstat(target)).isDirectory() || (await lstat(target)).isSymbolicLink()) throw new Error('Destination must be a real directory');
const files = [];
let copied = 0;
let reused = 0;
for (const [index, track] of receipt.checks.entries()) {
  const filename = singleEpisode ? 'hope-workplace-03.mp3' : `${String(index + 1).padStart(3, '0')}.m4a`;
  if (basename(track.path) !== filename || track.id !== (singleEpisode ? 'hope-workplace-03' : `daodejing-${filename.slice(0, 3)}`) ||
      !/^[a-f0-9]{64}$/.test(track.sha256) || track.decodeExitCode !== 0) throw new Error(`Invalid receipt entry: ${index}`);
  const source = resolve(root, singleEpisode ? 'public/audio/hope' : 'public/audio/daodejing', filename);
  const output = resolve(target, filename);
  if (await exists(output)) {
    if (!matches(await inspect(output), track)) throw new Error(`Existing backup differs; kept untouched: ${output}`);
    reused++;
  } else {
    if (!matches(await inspect(source), track)) throw new Error(`Source differs from validated media: ${filename}`);
    const temporary = resolve(target, `.${filename}.${randomUUID()}.partial`);
    try {
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
      if (!matches(await inspect(temporary), track)) throw new Error(`Backup readback failed: ${filename}`);
      // Publish a complete inode atomically; an existing final file is never replaced.
      await link(temporary, output);
      if (!matches(await inspect(output), track)) throw new Error(`Final readback failed: ${filename}`);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    copied++;
  }
  files.push({ id: track.id, filename, bytes: track.bytes, sha256: track.sha256, duration: track.duration });
}
const manifest = { schema: 1, topic: singleEpisode ? '万力豪·职场生存法则03' : '黄明哲·正解道德经', files };
const manifestPath = resolve(target, 'manifest.json');
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
if (await exists(manifestPath)) {
  if (await readFile(manifestPath, 'utf8') !== manifestText) throw new Error('Existing manifest differs; kept untouched');
} else {
  const pendingManifest = resolve(target, `.manifest.${randomUUID()}.partial`);
  try {
    await writeFile(pendingManifest, manifestText, { flag: 'wx' });
    await link(pendingManifest, manifestPath);
  } finally { await unlink(pendingManifest).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const result = { status: 'pass', verifiedAt: new Date().toISOString(), destination: target,
  count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), copied, reused,
  cloudSync: 'unverified', manifestSha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex') };
const reportPath = resolve(root, singleEpisode ? 'docs/qa/hope-backup-receipt.json' : 'docs/qa/icloud-backup-receipt.json');
const pendingReport = `${reportPath}.${randomUUID()}.partial`;
await writeFile(pendingReport, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
await rename(pendingReport, reportPath);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
