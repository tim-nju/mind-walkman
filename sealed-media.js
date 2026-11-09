const SealedMedia = (() => {
  class EnvelopeError extends Error {}
  function parseToken(value) {
    const match = /^([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) throw new EnvelopeError('私人收听链接不完整');
    const raw = Uint8Array.from(atob(match[2].replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
    return { id: match[1], raw };
  }
  async function open(envelope, label, bytes) {
    if (bytes.byteLength < 28) throw new EnvelopeError('加密文件不完整');
    const key = await crypto.subtle.importKey('raw', envelope.raw, 'AES-GCM', false, ['decrypt']);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12),
      additionalData: new TextEncoder().encode(`${envelope.id}/${label}`), tagLength: 128 }, key, bytes.slice(12));
  }
  return { parseToken, open };
})();
