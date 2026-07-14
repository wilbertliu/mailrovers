import type { NormalizedDraft, NormalizedMessage } from '@mailrovers/mail-domain'
import type { GmailMessage } from './schemas.js'
import { translateDraft, translateMessage } from './translate.js'

type CommonInput = Omit<Parameters<typeof translateMessage>[0], 'message' | 'signal'> & {
  message: GmailMessage
  signal: AbortSignal
}

export type DecodeAttachmentInput = {
  encoded: string
  declaredSizeBytes: number
  expectedSizeBytes: number
  maximumSizeBytes: number
  signal: AbortSignal
}

export function decodeGmailAttachment(input: Omit<DecodeAttachmentInput, 'signal'>): Uint8Array {
  const encoded = input.encoded.replace(/=+$/, '')
  const decoded = Buffer.from(encoded, 'base64url')
  if (decoded.toString('base64url') !== encoded)
    throw new Error('Gmail returned malformed attachment data')
  if (
    decoded.byteLength !== input.declaredSizeBytes ||
    decoded.byteLength !== input.expectedSizeBytes ||
    decoded.byteLength > input.maximumSizeBytes
  )
    throw new Error('Gmail returned an attachment with an unexpected size')
  return new Uint8Array(decoded)
}

export interface GmailNormalizer {
  normalizeMessage(input: CommonInput): Promise<NormalizedMessage>
  normalizeDraft(input: CommonInput & { providerDraftId: string }): Promise<NormalizedDraft>
  decodeAttachment(input: DecodeAttachmentInput): Promise<Uint8Array>
}

export class InlineGmailNormalizer implements GmailNormalizer {
  async normalizeMessage(input: CommonInput): Promise<NormalizedMessage> {
    return translateMessage(input)
  }

  async normalizeDraft(input: CommonInput & { providerDraftId: string }): Promise<NormalizedDraft> {
    return translateDraft(input)
  }

  async decodeAttachment(input: DecodeAttachmentInput): Promise<Uint8Array> {
    input.signal.throwIfAborted()
    return decodeGmailAttachment(input)
  }
}
