// All cryptographic operations using the native Web Crypto API.
// Private keys are stored in IndexedDB and never leave the browser.

import { openDB } from 'idb'
import { api } from '../api/client'
import { wrapPrivateKey, unwrapPrivateKey, downgradeToNonExtractable } from './recovery'

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

// Init order:
//   1. If a key already lives in IndexedDB on this device, use it. Done.
//   2. Else, if a recovery blob exists on the server AND we have the password,
//      unwrap it. This restores history after a PWA reinstall / new device.
//   3. Else, generate a fresh extractable keypair, wrap+upload the recovery
//      blob (if password is available), then downgrade to non-extractable for
//      local storage. This is the first-login path.
//
// Returns the keypair plus a flag describing how it was obtained so the caller
// can decide whether to upload the public key etc.
export async function initRecoverableKeyPair(
  username: string,
  password: string | null,
): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey; source: 'local' | 'recovered' | 'generated' }> {
  const db = await getKeyDB()
  const storedPriv = await db.get(DB_STORE, PRIVATE_KEY_ID)
  if (storedPriv) {
    const storedPub = await db.get(DB_STORE, PUBLIC_KEY_ID)
    return { privateKey: storedPriv, publicKey: storedPub, source: 'local' }
  }

  // No local key — try recovery first.
  if (password) {
    try {
      const { wrapped_privkey } = await api.getWrappedPrivkey()
      const { privateKey, publicKey } = await unwrapPrivateKey(wrapped_privkey, password, username)
      await db.put(DB_STORE, privateKey, PRIVATE_KEY_ID)
      await db.put(DB_STORE, publicKey, PUBLIC_KEY_ID)
      return { privateKey, publicKey, source: 'recovered' }
    } catch {
      // 404 (no blob yet) or wrong password — fall through to generate.
    }
  }

  // Fresh keypair. Extractable only long enough to wrap-and-upload, then
  // downgraded to non-extractable for IDB storage so the in-memory invariant
  // matches the rest of the codebase.
  const fresh = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  )
  if (password) {
    try {
      const blob = await wrapPrivateKey(fresh.privateKey, password, username)
      await api.uploadWrappedPrivkey(blob)
    } catch {
      // Network failure: still proceed with a usable local key. Recovery
      // upload will retry on the next successful login.
    }
  }
  const privateKey = await downgradeToNonExtractable(fresh.privateKey)
  await db.put(DB_STORE, privateKey, PRIVATE_KEY_ID)
  await db.put(DB_STORE, fresh.publicKey, PUBLIC_KEY_ID)
  return { privateKey, publicKey: fresh.publicKey, source: 'generated' }
}

// Legacy entry point — preserved for any caller that doesn't have a password
// in hand (e.g. service worker contexts). Returns a non-recoverable keypair if
// it has to generate one.
export async function getOrGenerateKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  const db = await getKeyDB()
  const stored = await db.get(DB_STORE, PRIVATE_KEY_ID)
  if (stored) {
    const pub = await db.get(DB_STORE, PUBLIC_KEY_ID)
    return { publicKey: pub, privateKey: stored }
  }
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
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
