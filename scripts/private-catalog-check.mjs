import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Execute the shipped browser scripts without introducing production exports.
const importer = await fs.readFile(process.env.IMPORTER_SOURCE || 'importer.js', 'utf8');
const storage = await fs.readFile('storage.js', 'utf8');
const item = { id: 'private-example', title: 'Example', date: '2026-11-09',
  fileName: 'example.m4a', duration: 10, bytes: 3,
  sha256: 'a'.repeat(64), mime: 'audio/mp4' };
function fixture(raw = null) {
  const elements = new Map();
  function element() {
    return { textContent: '', hidden: false, disabled: false, listeners: {},
      append(child) { elements.set(child.id, child); }, setAttribute() {},
      before(child) { child.parent = this.parent; elements.set(child.id, child); },
      addEventListener(name, action) { this.listeners[name] = action; } };
  }
  for (const id of ['importSection', 'importStatus', 'folderInput', 'filesInput',
    'btnStartImport', 'btnStopImport', 'importPreview']) elements.set(id, element());
  elements.get('importSection').hidden = true;
  elements.get('importSection').parent = 'main';
  const values = new Map(raw === null ? [] : [['mw_private_catalog', raw]]);
  let reloads = 0;
  const context = vm.createContext({ Error, JSON, DOMException, AbortController, Blob,
    crypto: webcrypto, Uint8Array,
    document: { getElementById: id => elements.get(id), createElement: element },
    localStorage: { getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value) },
    location: { reload() { reloads++; } },
    byId: id => elements.get(id), renderList() {}, updateOfflineStatus() {}, status() {} });
  vm.runInContext(importer, context);
  vm.runInContext('setupImporter()', context);
  return { context, values, elements, reloads: () => reloads,
    async choose(items) {
      const input = elements.get('privateCatalogInput');
      input.files = [{ text: async () => JSON.stringify(items) }];
      await input.listeners.change();
    } };
}
const results = [];
async function check(name, action) {
  try { await action(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) {
    results.push({ name, pass: false, message: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
await check('content identity collision rejects before save or cached import', async () => {
  for (const change of [{ sha256: 'b'.repeat(64) }, { bytes: 4 }]) {
    const original = JSON.stringify([item]);
    const f = fixture(original);
    await f.choose([{ ...item, ...change, title: 'Replacement' }]);
    assert.equal(f.values.get('mw_private_catalog'), original);
    assert.equal(f.reloads(), 0);
    assert.match(f.elements.get('privateCatalogStatus')?.textContent || '', /ID/);
  }
});
await check('merge retains omitted recordings and same identity metadata', async () => {
  const f = fixture(JSON.stringify([item]));
  const next = { ...item, id: 'private-second', fileName: 'second.m4a' };
  await f.choose([{ ...item, title: 'Changed title' }, next]);
  const saved = JSON.parse(f.values.get('mw_private_catalog'));
  assert.deepEqual(saved.map(entry => entry.id), [item.id, next.id]);
  assert.equal(saved[0].title, item.title);
  assert.equal(f.reloads(), 1);
  const g = fixture(JSON.stringify([item]));
  await g.choose([next]);
  assert.deepEqual(JSON.parse(g.values.get('mw_private_catalog')).map(entry => entry.id), [item.id, next.id]);
});
await check('duplicate and unselectable names reject within incoming and merged catalogs', async () => {
  for (const fileName of [item.fileName, '../x.m4a', 'a/b.m4a', 'a\\b.m4a',
    'x:m4a', '.', '..', ' x.m4a', 'x.m4a ', 'x\u0000.m4a']) {
    const original = JSON.stringify([item]);
    const f = fixture(original);
    await f.choose([{ ...item, id: 'private-second', fileName }]);
    assert.equal(f.values.get('mw_private_catalog'), original, fileName);
    assert.equal(f.reloads(), 0, fileName);
  }
  const f = fixture();
  await f.choose([item, { ...item, id: 'private-second' }]);
  assert.equal(f.values.has('mw_private_catalog'), false);
});
await check('malformed persisted data blocks overwrite and stays recoverable', async () => {
  for (const raw of ['{broken', '{}', '[{}]']) {
    const f = fixture(raw);
    assert.throws(() => vm.runInContext('readPrivateCatalog()', f.context));
    await f.choose([item]);
    assert.equal(f.values.get('mw_private_catalog'), raw);
    assert.equal(f.reloads(), 0);
  }
  assert.equal(vm.runInContext('readPrivateCatalog().length', fixture().context), 0);
  assert.equal(vm.runInContext('readPrivateCatalog().length', fixture('[]').context), 0);
});
await check('quota and security failures remain visible outside hidden import section', async () => {
  for (const operation of ['getItem', 'setItem']) {
    const raw = JSON.stringify([item]);
    const f = fixture(raw);
    f.context.localStorage[operation] = () => { throw new DOMException('blocked storage', operation === 'getItem' ? 'SecurityError' : 'QuotaExceededError'); };
    await f.choose([{ ...item, id: 'private-second', fileName: 'second.m4a' }]);
    const message = f.elements.get('privateCatalogStatus');
    assert.match(message.textContent, /blocked storage/);
    assert.equal(message.parent, 'main');
    assert.equal(message.hidden, false);
    assert.equal(f.elements.get('importSection').hidden, true);
    assert.equal(f.values.get('mw_private_catalog'), raw);
    assert.equal(f.reloads(), 0);
  }
});
await check('actual file importer checks bytes and SHA and retains cached recording', async () => {
  const f = fixture(JSON.stringify([item]));
  vm.runInContext(storage, f.context);
  const bytes = new Blob(['abc']);
  const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', await bytes.arrayBuffer())).toString('hex');
  const valid = { ...item, sha256: digest };
  f.context.recording = valid;
  f.context.sample = bytes;
  f.context.saved = new Map();
  vm.runInContext(`AudioStore.put = async (id, blob) => saved.set(id, blob);
    globalThis.topic = { title: 'Fixture', tracks: [recording] };
    globalThis.track = recording;
    globalThis.cacheKeys = new Set();
    globalThis.sourceReady = false;
    globalThis.downloadController = null;`, f.context);
  await assert.rejects(vm.runInContext(`AudioStore.importFile({ ...recording, sha256: '${'b'.repeat(64)}' }, sample, new AbortController().signal)`, f.context), /校验失败/);
  await assert.rejects(vm.runInContext('AudioStore.importFile({ ...recording, bytes: 4 }, sample, new AbortController().signal)', f.context), /大小不符/);
  // Use a real Blob with the File name contract rather than a second parser implementation.
  Object.defineProperty(bytes, 'name', { value: item.fileName });
  f.context.files = [bytes];
  vm.runInContext('showImportSelection(files)', f.context);
  await vm.runInContext('importSelectedFiles()', f.context);
  assert.equal(await f.context.saved.get(item.id).text(), 'abc');
  await vm.runInContext('importSelectedFiles()', f.context);
  assert.match(f.elements.get('importStatus').textContent, /已有 1 集/);
});
if (process.env.RESULT_PATH) await fs.writeFile(process.env.RESULT_PATH, JSON.stringify({ status: process.exitCode ? 'fail' : 'pass', results }, null, 2));
