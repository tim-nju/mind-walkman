/* Existing database and keys remain compatible with the single-track player. */
const AudioStore = (() => {
  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('MindWalkmanDB', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('audio_files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function transact(mode, operation) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('audio_files', mode);
        const request = operation(tx.objectStore('audio_files'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error || request.error || new DOMException('缓存事务失败', 'AbortError'));
        tx.onabort = () => reject(tx.error || new DOMException('缓存写入已取消', 'AbortError'));
      });
    } finally { db.close(); }
  }
  return {
    get: (id) => transact('readonly', store => store.get(id)),
    keys: () => transact('readonly', store => store.getAllKeys()),
    put: (id, blob) => transact('readwrite', store => store.put(blob, id)),
    async importFile(track, blob, signal) {
      if (signal.aborted) throw new DOMException('导入已停止', 'AbortError');
      if (track.bytes && blob.size !== track.bytes) throw new Error('文件大小不符，请重新从 iCloud 下载这一集');
      if (track.sha256) {
        const bytes = await blob.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (sha256 !== track.sha256) throw new Error('文件内容校验失败，请重新从 iCloud 下载这一集');
      }
      if (signal.aborted) throw new DOMException('导入已停止', 'AbortError');
      await this.put(track.id, new Blob([blob], { type: track.mime || 'audio/mpeg' }));
    },
    async download(track, signal) {
      if (track.localOnly) throw new Error('请选择本地私人音频文件');
      if (track.privateAudio && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('请从 iCloud 文件夹导入课程');
      // Native fetch retained for the zero-build, dependency-free browser app.
      const response = await fetch(track.audioSrc, { signal });
      if (response.status !== 200) throw new Error(`音频下载 HTTP ${response.status}`);
      const blob = await response.blob();
      const contentType = response.headers.get('content-type') || '';
      if (!blob.size || !/^(audio\/|video\/mp4|application\/octet-stream)/i.test(contentType)) {
        throw new Error('返回内容不是完整音频');
      }
      if (signal.aborted) throw new DOMException('下载已停止', 'AbortError');
      if (track.bytes && blob.size !== track.bytes) throw new Error('音频长度不完整，请重新下载');
      const typedBlob = new Blob([blob], { type: track.mime || 'audio/mpeg' });
      const probe = document.createElement('audio');
      const probeURL = URL.createObjectURL(typedBlob);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('音频校验超时')), 20000);
          probe.onloadedmetadata = () => {
            clearTimeout(timer);
            if (Number.isFinite(probe.duration) && probe.duration > 0) resolve();
            else reject(new Error('音频时长无效'));
          };
          probe.onerror = () => { clearTimeout(timer); reject(new Error('下载内容无法解码为音频')); };
          probe.src = probeURL;
          probe.preload = 'metadata';
        });
        if (signal.aborted) throw new DOMException('下载已停止', 'AbortError');
        await this.importFile(track, typedBlob, signal);
      } finally {
        probe.removeAttribute('src');
        probe.load();
        URL.revokeObjectURL(probeURL);
      }
    }
  };
})();
