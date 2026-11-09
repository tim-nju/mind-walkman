import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import path from 'node:path';

const [catalogFile, mediaFile] = process.argv.slice(2);
if (!catalogFile || !mediaFile) throw new Error('Usage: node scripts/seal-media.mjs <private-catalog> <media>');
const [track] = JSON.parse(await readFile(catalogFile, 'utf8'));
const media = await readFile(mediaFile);
if (media.length !== track.bytes || createHash('sha256').update(media).digest('hex') !== track.sha256) {
  throw new Error('Source does not match private catalog');
}
const id = randomBytes(16).toString('hex');
const key = randomBytes(32);
const output = path.join('public/sealed', id);
await mkdir(output, { recursive: true });
async function seal(label, data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${id}/${label}`));
  const ciphertext = Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  await writeFile(path.join(output, `${label}.bin`), ciphertext, { flag: 'wx' });
}
const partSize = 1024 * 1024;
const parts = Math.ceil(media.length / partSize);
for (let index = 0; index < parts; index++) await seal(String(index), media.subarray(index * partSize, (index + 1) * partSize));
await seal('manifest', Buffer.from(JSON.stringify({ version: 1, track, parts, partSize })));
await mkdir('.private-media', { recursive: true });
const url = `https://tim-nju.github.io/mind-walkman/listen.html#listen=${id}.${key.toString('base64url')}`;
await writeFile('.private-media/listen-link.txt', url + '\n', { mode: 0o600, flag: 'wx' });
await writeFile('.private-media/sealed-receipt.json', JSON.stringify({ id, parts, bytes: media.length, sha256: track.sha256 }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ id, parts, bytes: media.length, privateLinkFile: '.private-media/listen-link.txt' }));
