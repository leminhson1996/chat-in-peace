// Password-derived wrapping of the user's ECDH private key so it can be
// recovered on a fresh device / after a PWA reinstall. The server only ever
// stores the opaque ciphertext blob; the password never leaves the client.

const SALT_PREFIX = 'cip-recovery:'
const PBKDF2_ITERATIONS = 600_000

async function deriveWrappingKey(password: string, username: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode(SALT_PREFIX + username)
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// Caller must hold an EXTRACTABLE private key. Returns the JSON blob to upload.
export async function wrapPrivateKey(
  privExtractable: CryptoKey,
  password: string,
  username: string,
): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privExtractable)
  const wrap = await deriveWrappingKey(password, username)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrap, pkcs8)
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
  })
}

// Returns BOTH halves: private as NON-extractable (matches the in-memory
// invariant the rest of the app expects), public as extractable so we can
// re-export and upload it.
export async function unwrapPrivateKey(
  blob: string,
  password: string,
  username: string,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
  const { iv, ct } = JSON.parse(blob)
  const wrap = await deriveWrappingKey(password, username)
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0))
  const ctBytes = Uint8Array.from(atob(ct), c => c.charCodeAt(0))
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, wrap, ctBytes)

  // Web Crypto can't expose the public half of a PKCS#8 private key directly.
  // Round-trip through JWK: import once as extractable to read x,y,d, then
  // re-import the private (without d capability) as non-extractable, and the
  // public (jwk minus d) separately.
  const extPriv = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', extPriv)
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  )
  const pubJwk = { ...jwk }
  delete pubJwk.d
  pubJwk.key_ops = []
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    pubJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )
  return { privateKey, publicKey }
}

// Decrypt a wrapped-privkey blob with the current password and re-encrypt with
// a new one — used by self-serve password change. We never go through a
// CryptoKey, so this works even when the in-IDB private key is non-extractable.
// Throws OperationError if `currentPassword` is wrong (AES-GCM auth tag fails).
export async function rewrapPrivateKey(
  blob: string,
  currentPassword: string,
  newPassword: string,
  username: string,
): Promise<string> {
  const { iv, ct } = JSON.parse(blob)
  const oldWrap = await deriveWrappingKey(currentPassword, username)
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0))
  const ctBytes = Uint8Array.from(atob(ct), c => c.charCodeAt(0))
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, oldWrap, ctBytes)

  const newWrap = await deriveWrappingKey(newPassword, username)
  const newIv = crypto.getRandomValues(new Uint8Array(12))
  const newCt = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: newIv }, newWrap, pkcs8)
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...newIv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(newCt))),
  })
}

// Take a freshly-generated EXTRACTABLE private key and re-import the same key
// material as NON-extractable so it can be safely persisted in IndexedDB.
export async function downgradeToNonExtractable(priv: CryptoKey): Promise<CryptoKey> {
  const jwk = await crypto.subtle.exportKey('jwk', priv)
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  )
}
