export class SyncTransportError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

export function createSyncTransport(origin) {
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('invalid_sync_origin');
  }
  return async function request(path, token, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      if (encoded && new TextEncoder().encode(encoded).length > 256 * 1024) throw new SyncTransportError('request_too_large', 413);
      const response = await fetch(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(encoded ? { 'Content-Type': 'application/json' } : {}) },
        body: encoded, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SyncTransportError(response.status === 401 ? 'authorization_required' :
          response.status === 409 ? 'source_conflict' : `http_${response.status}`, response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SyncTransportError('invalid_response');
      let bytes = 0;
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 256 * 1024) { await reader.cancel(); throw new SyncTransportError('response_too_large'); }
        chunks.push(value);
      }
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder().decode(data)); }
      catch { throw new SyncTransportError('invalid_response'); }
    } catch (error) {
      if (error instanceof SyncTransportError) throw error;
      throw new SyncTransportError(error.name === 'AbortError' ? 'request_timeout' : 'network_unavailable');
    } finally { clearTimeout(timeout); }
  };
}
