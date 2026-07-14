import type { MailAddress } from './mail.js'

export type DraftRevisionFingerprint = string & {
  readonly __brand: 'DraftRevisionFingerprint'
}

export type CanonicalDraftRevision = {
  internetMessageId: string
  sender: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  textBody: string
  htmlBody?: string | undefined
  providerThreadId?: string | undefined
  inReplyTo?: string | undefined
  references: string[]
}

function text(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}

/** Gmail omits an empty HTML MIME part, so it is not provider-visible content. */
export function normalizeDraftHtmlBody(value: string | undefined): string | undefined {
  return value === '' ? undefined : value
}

function address(value: MailAddress): { address: string; name?: string | undefined } {
  const normalizedName = value.name === undefined ? undefined : text(value.name.trim())
  return {
    address: text(value.address.trim().toLowerCase()),
    ...(normalizedName === undefined || normalizedName.length === 0
      ? {}
      : { name: normalizedName }),
  }
}

/**
 * Produces the versioned provider-visible representation used to prove that an
 * ambiguous draft/save result is the exact revision that was submitted.
 */
export function canonicalizeDraftRevision(value: CanonicalDraftRevision): string {
  return JSON.stringify({
    version: 1,
    internetMessageId: text(value.internetMessageId.trim()),
    sender: address(value.sender),
    to: value.to.map(address),
    cc: value.cc.map(address),
    bcc: value.bcc.map(address),
    subject: text(value.subject),
    textBody: text(value.textBody),
    ...(normalizeDraftHtmlBody(value.htmlBody) === undefined
      ? {}
      : { htmlBody: text(normalizeDraftHtmlBody(value.htmlBody)!) }),
    ...(value.providerThreadId === undefined
      ? {}
      : { providerThreadId: text(value.providerThreadId) }),
    ...(value.inReplyTo === undefined ? {} : { inReplyTo: text(value.inReplyTo.trim()) }),
    references: value.references.map((reference) => text(reference.trim())),
  })
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0
      const previous2 = words[index - 2] ?? 0
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3)
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10)
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25)
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0))
      const temporary1 =
        ((h ?? 0) + sum1 + choice + (SHA256_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0
      const sum0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22)
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0))
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = ((d ?? 0) + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    const state = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < hash.length; index += 1)
      hash[index] = ((hash[index] ?? 0) + (state[index] ?? 0)) >>> 0
  }
  return [...hash].map((word) => word.toString(16).padStart(8, '0')).join('')
}

export function fingerprintDraftRevision(value: CanonicalDraftRevision): DraftRevisionFingerprint {
  return sha256(canonicalizeDraftRevision(value)) as DraftRevisionFingerprint
}

export function draftRevisionFingerprint(value: string): DraftRevisionFingerprint {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid draft revision fingerprint')
  return value as DraftRevisionFingerprint
}
