import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import {
  initRecoverableKeyPair,
  exportPublicKey,
  getSharedKey,
  getCachedRoomKey,
  encryptMessage,
  decryptMessage,
  generateRoomKey,
  wrapRoomKey,
  exportPublicKey as expPub,
} from '../crypto'
import { useAuthStore } from '../store/authStore'
import type { Message } from '../api/client'

export interface CryptoReady {
  ready: boolean
  encryptForDM: (recipientUsername: string, text: string) => Promise<{ iv: string; ct: string }>
  decryptDM: (senderUsername: string, msg: Message) => Promise<string>
  encryptForRoom: (roomId: string, text: string) => Promise<{ iv: string; ct: string }>
  decryptRoom: (roomId: string, msg: Message) => Promise<string>
  createRoomKeys: (members: string[]) => Promise<Record<string, string>> // username → wrappedKey
  wrapRoomKeyForUser: (roomId: string, recipientUsername: string) => Promise<string>
}

export function useCrypto(): CryptoReady {
  const username = useAuthStore(s => s.username)
  const privateKeyRef = useRef<CryptoKey | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!username) return
    let cancelled = false
    async function init() {
      // Pull password from the store (in-memory only; cleared on logout) so
      // we can wrap/unwrap the recovery blob during init.
      const password = useAuthStore.getState().password
      const kp = await initRecoverableKeyPair(username!, password)
      if (cancelled) return
      privateKeyRef.current = kp.privateKey
      // Upload the public key on every init — idempotent on the server and
      // makes sure it stays in sync after a recovery on a fresh device.
      try {
        const pubB64 = await exportPublicKey(kp.publicKey)
        await api.uploadPubkey(pubB64)
      } catch { /* network error — proceed */ }
      if (!cancelled) setReady(true)
    }
    init()
    return () => { cancelled = true }
  }, [username])

  async function getMyPrivate(): Promise<CryptoKey> {
    if (privateKeyRef.current) return privateKeyRef.current
    const password = useAuthStore.getState().password
    const kp = await initRecoverableKeyPair(username!, password)
    privateKeyRef.current = kp.privateKey
    return kp.privateKey
  }

  async function getPeerKey(peerUsername: string): Promise<string> {
    const data = await api.getPubkey(peerUsername)
    return data.pubkey
  }

  const encryptForDM = async (recipientUsername: string, text: string) => {
    const priv = await getMyPrivate()
    const theirPubB64 = await getPeerKey(recipientUsername)
    const key = await getSharedKey(priv, theirPubB64, `dm:${recipientUsername}`)
    return encryptMessage(key, text)
  }

  const decryptDM = async (senderUsername: string, msg: Message) => {
    const priv = await getMyPrivate()
    const theirPubB64 = await getPeerKey(senderUsername)
    const key = await getSharedKey(priv, theirPubB64, `dm:${senderUsername}`)
    try {
      return await decryptMessage(key, msg.iv, msg.ct)
    } catch {
      return '[encrypted]'
    }
  }

  const encryptForRoom = async (roomId: string, text: string) => {
    const priv = await getMyPrivate()
    const { wrapped_key } = await api.getRoomKey(roomId)
    const key = await getCachedRoomKey(roomId, wrapped_key, priv)
    return encryptMessage(key, text)
  }

  const decryptRoom = async (roomId: string, msg: Message) => {
    const priv = await getMyPrivate()
    try {
      const { wrapped_key } = await api.getRoomKey(roomId)
      const key = await getCachedRoomKey(roomId, wrapped_key, priv)
      return await decryptMessage(key, msg.iv, msg.ct)
    } catch {
      return '[encrypted]'
    }
  }

  const createRoomKeys = async (members: string[]): Promise<Record<string, string>> => {
    const roomKey = await generateRoomKey()
    const result: Record<string, string> = {}
    for (const member of members) {
      const theirPubB64 = await getPeerKey(member)
      result[member] = await wrapRoomKey(roomKey, theirPubB64)
    }
    // Also wrap for self
    const password = useAuthStore.getState().password
    const kp = await initRecoverableKeyPair(username!, password)
    const myPubB64 = await expPub(kp.publicKey)
    result[username!] = await wrapRoomKey(roomKey, myPubB64)
    return result
  }

  const wrapRoomKeyForUser = async (roomId: string, recipientUsername: string): Promise<string> => {
    const priv = await getMyPrivate()
    const { wrapped_key } = await api.getRoomKey(roomId)
    const roomKey = await getCachedRoomKey(roomId, wrapped_key, priv)
    const theirPubB64 = await getPeerKey(recipientUsername)
    return wrapRoomKey(roomKey, theirPubB64)
  }

  return { ready, encryptForDM, decryptDM, encryptForRoom, decryptRoom, createRoomKeys, wrapRoomKeyForUser }
}
