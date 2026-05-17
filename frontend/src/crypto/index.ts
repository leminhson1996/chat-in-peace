// All cryptographic operations using the native Web Crypto API.
// Private keys are stored in IndexedDB and never leave the browser.

import { openDB } from 'idb'

const DB_NAME = 'cip-keys'
const DB_STORE = 'keys'
const PRIVATE_KEY_ID = 'my-private-key'
const PUBLIC_KEY_ID = 'my-public-key'

async function getKeyDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(DB_STORE)
    },
  })
}

export async function getOrGenerateKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  const db = await getKeyDB()
  const stored = await db.get(DB_STORE, PRIVATE_KEY_ID)
  if (stored) {
    const pub = await db.get(DB_STORE, PUBLIC_KEY_ID)
    return { publicKey: pub, privateKey: stored }
  }
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key non-extractable
    ['deriveKey', 'deriveBits'],
  )
  await db.put(DB_STORE, kp.privateKey, PRIVATE_KEY_ID)
  await db.put(DB_STORE, kp.publicKey, PUBLIC_KEY_ID)
  return kp
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key)
  return btoa(String.fromCharCode(...new Uint8Array(spki)))
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
  const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'spki',
    binary.buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )
}

async function deriveSharedAESKey(myPrivate: CryptoKey, theirPublic: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublic },
    myPrivate,
    256,
  )
  // HKDF to get a proper AES-GCM key
  const baseKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('cip-dm') },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// Cache derived shared keys in memory
const sharedKeyCache = new Map<string, CryptoKey>()

export async function getSharedKey(myPrivate: CryptoKey, theirPubB64: string, cacheKey: string): Promise<CryptoKey> {
  if (sharedKeyCache.has(cacheKey)) return sharedKeyCache.get(cacheKey)!
  const theirPub = await importPublicKey(theirPubB64)
  const key = await deriveSharedAESKey(myPrivate, theirPub)
  sharedKeyCache.set(cacheKey, key)
  return key
}

export async function encryptMessage(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  }
}

export async function decryptMessage(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

// ── Room keys ──────────────────────────────────────────────────────────────

const roomKeyCache = new Map<string, CryptoKey>()

export async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function wrapRoomKey(roomKey: CryptoKey, recipientPubB64: string): Promise<string> {
  const recipientPub = await importPublicKey(recipientPubB64)
  // Export the room key raw, then encrypt with ECDH-derived wrapping key
  const rawRoomKey = await crypto.subtle.exportKey('raw', roomKey)
  // Use the recipient's public key and an ephemeral ECDH to wrap
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  const wrappingKey = await deriveSharedAESKey(ephemeral.privateKey, recipientPub)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawRoomKey)
  // Export ephemeral public key
  const ephPubSpki = await crypto.subtle.exportKey('spki', ephemeral.publicKey)
  const ephPubB64 = btoa(String.fromCharCode(...new Uint8Array(ephPubSpki)))
  // Pack: ephPubB64|ivB64|wrappedB64
  return JSON.stringify({
    eph: ephPubB64,
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(wrapped))),
  })
}

export async function unwrapRoomKey(packed: string, myPrivate: CryptoKey): Promise<CryptoKey> {
  const { eph, iv, ct } = JSON.parse(packed)
  const ephPub = await importPublicKey(eph)
  const wrappingKey = await deriveSharedAESKey(myPrivate, ephPub)
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0))
  const ctBytes = Uint8Array.from(atob(ct), c => c.charCodeAt(0))
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, wrappingKey, ctBytes)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function getCachedRoomKey(roomId: string, packed: string, myPrivate: CryptoKey): Promise<CryptoKey> {
  if (roomKeyCache.has(roomId)) return roomKeyCache.get(roomId)!
  const key = await unwrapRoomKey(packed, myPrivate)
  roomKeyCache.set(roomId, key)
  return key
}

export function clearCryptoCache() {
  sharedKeyCache.clear()
  roomKeyCache.clear()
}
