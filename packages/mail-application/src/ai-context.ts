import type {
  AiArtifactType,
  ConversationDetail,
  Draft,
  MessageBody,
} from '@mailrovers/mail-contracts'
import type { AiSourceMessage } from './ai-runtime.js'

export const MAX_CONTEXT_MESSAGES = 32
export const MAX_CONTEXT_BYTES = 64 * 1024
const MAX_MESSAGE_BYTES = 16 * 1024

function truncateUtf8(value: string, limit: number): { text: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= limit) return { text: value, truncated: false }
  return {
    text: new TextDecoder().decode(encoded.slice(0, limit)),
    truncated: true,
  }
}

function contextCandidates(conversation: ConversationDetail, artifactType: AiArtifactType) {
  const indexed = conversation.messages.map((message, index) => ({ message, index }))
  return artifactType === 'conversation_summary' && indexed.length > 1
    ? [indexed[0]!, ...indexed.slice(1).reverse()]
    : indexed.reverse()
}

export function aiContextMessageIds(
  conversation: ConversationDetail,
  artifactType: AiArtifactType,
): ConversationDetail['messages'][number]['id'][] {
  return contextCandidates(conversation, artifactType)
    .slice(0, MAX_CONTEXT_MESSAGES)
    .map((candidate) => candidate.message.id)
}

export function selectAiContext(
  conversation: ConversationDetail,
  bodies: MessageBody[],
  artifactType: AiArtifactType,
): { messages: AiSourceMessage[]; truncated: boolean } {
  const candidates = contextCandidates(conversation, artifactType)
  const bodiesById = new Map(bodies.map((body) => [body.messageId, body]))
  const selected: Array<{ message: AiSourceMessage; index: number }> = []
  let bytes = 0
  let truncated = candidates.length > MAX_CONTEXT_MESSAGES
  for (const candidate of candidates) {
    if (!candidate || selected.length >= MAX_CONTEXT_MESSAGES) break
    const body = bodiesById.get(candidate.message.id)
    const bounded = truncateUtf8(body?.textBody ?? body?.sanitizedHtmlBody ?? '', MAX_MESSAGE_BYTES)
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
