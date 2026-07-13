import type { AiArtifactType, ConversationDetail, Draft } from '@mailrovers/mail-contracts'
import type { AiSourceMessage } from './ai-runtime.js'

const MAX_CONTEXT_MESSAGES = 32
const MAX_CONTEXT_BYTES = 64 * 1024
const MAX_MESSAGE_BYTES = 16 * 1024

function truncateUtf8(value: string, limit: number): { text: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= limit) return { text: value, truncated: false }
  return {
    text: new TextDecoder().decode(encoded.slice(0, limit)),
    truncated: true,
  }
}

export function selectAiContext(
  conversation: ConversationDetail,
  artifactType: AiArtifactType,
): { messages: AiSourceMessage[]; truncated: boolean } {
  const indexed = conversation.messages.map((message, index) => ({ message, index }))
  const candidates =
    artifactType === 'conversation_summary' && indexed.length > 1
      ? [indexed[0], ...indexed.slice(1).reverse()]
      : indexed.reverse()
  const selected: Array<{ message: AiSourceMessage; index: number }> = []
  let bytes = 0
  let truncated = candidates.length > MAX_CONTEXT_MESSAGES
  for (const candidate of candidates) {
    if (!candidate || selected.length >= MAX_CONTEXT_MESSAGES) break
    const body = candidate.message.textBody ?? candidate.message.sanitizedHtmlBody ?? ''
    const bounded = truncateUtf8(body, MAX_MESSAGE_BYTES)
    const message: AiSourceMessage = {
      id: candidate.message.id,
      sender: candidate.message.sender,
      recipients: candidate.message.recipients,
      ...(candidate.message.sentAt === undefined ? {} : { sentAt: candidate.message.sentAt }),
      receivedAt: candidate.message.receivedAt,
      text: bounded.text,
    }
    const size = new TextEncoder().encode(JSON.stringify(message)).byteLength
    if (bytes + size > MAX_CONTEXT_BYTES) {
      truncated = true
      continue
    }
    truncated ||= bounded.truncated
    bytes += size
    selected.push({ message, index: candidate.index })
  }
  selected.sort((left, right) => left.index - right.index)
  return { messages: selected.map((entry) => entry.message), truncated }
}

export function recipientFingerprint(draft: Draft): string {
  const normalize = (addresses: Draft['to']) =>
    addresses.map((entry) => entry.address.trim().toLowerCase()).sort()
  return JSON.stringify({
    to: normalize(draft.to),
    cc: normalize(draft.cc),
    bcc: normalize(draft.bcc),
  })
}
