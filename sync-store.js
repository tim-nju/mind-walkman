// Every mutation reads the latest committed data inside the same IDB transaction.
// No async work is allowed in the callback: crypto and HTTP happen outside it.
export function createSyncStore() {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('MindWalkmanSync', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'key' });
      request.onerror = () => { opening = null; reject(request.error); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    });
    return opening;
  }
  return {
    async transaction(callback, mode = 'readwrite') {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('entries', mode);
        const store = tx.objectStore('entries');
        let result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('storage_aborted'));
        const request = store.getAll();
        request.onsuccess = () => {
          const entries = new Map(request.result.map(entry => [entry.key, entry.value]));
          try {
            result = callback({
              get: key => entries.get(key),
              values: prefix => [...entries].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value),
              put(key, value) { entries.set(key, value); store.put({ key, value }); },
              delete(key) { entries.delete(key); store.delete(key); }
            });
            if (result && typeof result.then === 'function') throw new Error('async_storage_callback');
          } catch (error) { failure = error; tx.abort(); }
        };
      });
    },
    async close() {
      if (opening) (await opening).close();
      opening = null;
    }
  };
}
