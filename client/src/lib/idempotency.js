const mask = 0xffffffffffffffffn;
const prime = 0x100000001b3n;
const ephemeralRequests = new Map();

function fingerprint(value) {
  const text = String(value);
  const hash = (seed) => {
    let result = seed;
    for (const character of text) {
      result = ((result ^ BigInt(character.codePointAt(0))) * prime) & mask;
    }
    return result.toString(16).padStart(16, '0');
  };
  return `${hash(0xcbf29ce484222325n)}${hash(0x84222325cbf29ce4n)}`;
}

const keyStorageName = (scope, requestFingerprint) => `osp.idempotency.pending.${fingerprint(scope)}.${requestFingerprint}`;

export function getPersistentIdempotencyRequest(scope, payload) {
  const requestFingerprint = fingerprint(payload);
  const storageName = keyStorageName(scope, requestFingerprint);
  const ephemeral = ephemeralRequests.get(storageName);
  if (ephemeral?.expiresAt > Date.now()) return { key: ephemeral.key, fingerprint: requestFingerprint };

  try {
    const pending = JSON.parse(globalThis.localStorage?.getItem(storageName) || 'null');
    if (pending?.expiresAt > Date.now() && typeof pending.key === 'string') {
      ephemeralRequests.set(storageName, pending);
      return { key: pending.key, fingerprint: requestFingerprint };
    }
  } catch { /* storage can be disabled; the current app session still gets a stable key */ }

  const pending = {
    key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  ephemeralRequests.set(storageName, pending);
  try { globalThis.localStorage?.setItem(storageName, JSON.stringify(pending)); }
  catch { /* storage can be disabled; retry remains stable while this app session stays open */ }
  return { key: pending.key, fingerprint: requestFingerprint };
}

export function clearPersistentIdempotencyRequest(scope, requestFingerprint) {
  const storageName = keyStorageName(scope, requestFingerprint);
  ephemeralRequests.delete(storageName);
  try { globalThis.localStorage?.removeItem(storageName); }
  catch { /* storage cleanup must not change the result of a successful request */ }
}
