window.addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).has('listen')) location.reload();
});
(() => {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('listen')) return;
  const token = fragment.get('listen');
  history.replaceState(null, '', location.pathname + location.search);
  const panel = document.createElement('section');
  panel.className = 'import-section';
  panel.setAttribute('aria-label', '私人收听');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const retry = document.createElement('button');
  retry.className = 'import-button';
  retry.textContent = '重新准备';
  retry.hidden = true;
  panel.append(message, retry);
  document.querySelector('.topic-picker').before(panel);
  async function prepare() {
    retry.hidden = true;
    message.textContent = '正在安全准备私人录音，请保持页面打开…';
    try {
      const envelope = SealedMedia.parseToken(token);
      async function download(label) {
        const response = await fetch(`./public/sealed/${envelope.id}/${label}.bin`, {
          signal: AbortSignal.timeout(120000), redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'
        });
        if (response.status !== 200) throw new Error('网络下载未完成');
        return SealedMedia.open(envelope, label, await response.arrayBuffer());
      }
      const manifest = JSON.parse(new TextDecoder().decode(await download('manifest')));
      const partSize = manifest.partSize ?? 8 * 1024 * 1024;
      if (manifest.version !== 1 || ![524288, 1048576, 8388608].includes(partSize) || !Number.isSafeInteger(manifest.parts) || manifest.parts < 1 || manifest.parts > 1024) {
        throw new Error('私人收听包格式无效');
      }
      const incoming = privateCatalog([manifest.track])[0];
      if (incoming.bytes > 512 * 1024 * 1024 || manifest.parts !== Math.ceil(incoming.bytes / partSize)) {
        throw new Error('私人收听包长度无效');
      }
      const entries = readPrivateCatalog();
      const existing = entries.find(item => item.id === incoming.id);
      if (existing && (existing.bytes !== incoming.bytes || existing.sha256 !== incoming.sha256)) {
        throw new Error('原目录已包含不同内容，已保留原录音');
      }
      const cached = await AudioStore.get(incoming.id);
      if (!cached) {
        const pieces = [];
        for (let index = 0; index < manifest.parts; index++) {
          message.textContent = `正在准备 ${incoming.title}（${index + 1}/${manifest.parts}）…首次准备后可离线收听。`;
          const bytes = await download(String(index));
          const expected = Math.min(partSize, incoming.bytes - index * partSize);
          if (bytes.byteLength !== expected) throw new Error('录音分块长度不符');
          pieces.push(new Blob([bytes]));
        }
        await AudioStore.importFile(incoming, new Blob(pieces, { type: incoming.mime }), new AbortController().signal);
      } else {
        await AudioStore.importFile(incoming, cached, new AbortController().signal);
      }
      if (!existing) entries.push(incoming);
      privateCatalog(entries);
      localStorage.setItem('mw_private_catalog', JSON.stringify(entries));
      let library = topics.find(item => item.id === 'private-library');
      if (!library) {
        library = { id: 'private-library', title: '私人录音', tracks: [] };
        topics.push(library);
        byId('topicSelect').append(new Option(library.title, library.id));
      }
      let target = allTracks.find(item => item.id === incoming.id);
      if (!target) { target = incoming; library.tracks.push(target); allTracks.push(target); }
      await refreshCache();
      await selectTrack(target);
      byId('importSection').hidden = true;
      message.textContent = '已准备好，点击播放即可收听；以后在这里打开会续播，无需再导入文件。';
      panel.dataset.ready = 'true';
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      message.textContent = '准备未完成：请检查网络或使用完整的私人收听链接。已有录音和进度保持不变。';
      retry.hidden = false;
      panel.dataset.ready = 'false';
    }
  }
  retry.addEventListener('click', prepare);
  prepare();
})();
