export const MAX_BYTES = 64 * 1024;
export function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_BYTES) throw new Error('message-too-large');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export function decoder(onMessage, onError) {
  let buffered = Buffer.alloc(0), failed = false;
  return chunk => {
    if (failed) return;
    buffered = Buffer.concat([buffered, chunk]);
    try {
      while (buffered.length >= 4) {
        const size = buffered.readUInt32LE(0);
        if (!size || size > MAX_BYTES) throw new Error('invalid-size');
        if (buffered.length < size + 4) return;
        const value = JSON.parse(buffered.subarray(4, size + 4).toString('utf8'));
        buffered = buffered.subarray(size + 4);
        onMessage(value);
      }
    } catch { failed = true; buffered = Buffer.alloc(0); onError(); }
  };
}
export function validPing(m) {
  return m && Object.keys(m).sort().join(',') === 'client,kind,seq,v' && m.v === 1 && m.kind === 'ping'
    && typeof m.client === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(m.client)
    && Number.isSafeInteger(m.seq) && m.seq > 0;
}
