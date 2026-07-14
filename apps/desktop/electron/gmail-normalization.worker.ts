import { decodeGmailAttachment, translateDraft, translateMessage } from '@mailrovers/provider-gmail'
import { parentPort } from 'node:worker_threads'

if (!parentPort) throw new Error('Gmail normalization worker requires a parent port')

const port = parentPort
type MessageRequest = {
  id: number
  kind: 'message'
  input: Omit<Parameters<typeof translateMessage>[0], 'signal'>
}
type DraftRequest = {
  id: number
  kind: 'draft'
  input: Omit<Parameters<typeof translateDraft>[0], 'signal'>
}
type AttachmentRequest = {
  id: number
  kind: 'attachment'
  input: Parameters<typeof decodeGmailAttachment>[0]
}

port.on('message', (request: MessageRequest | DraftRequest | AttachmentRequest) => {
  try {
    const result =
      request.kind === 'message'
        ? translateMessage(request.input)
        : request.kind === 'draft'
          ? translateDraft(request.input)
          : decodeGmailAttachment(request.input)
    port.postMessage({ kind: 'result', id: request.id, result })
  } catch (error) {
    port.postMessage({
      kind: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Gmail normalization failed',
    })
  }
})

port.postMessage({ kind: 'ready' })
