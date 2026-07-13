import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import {
  acceptAiReplyInputSchema,
  aiConfigurationResultSchema,
  aiStreamReceiptResultSchema,
  clearAiConfigurationInputSchema,
  draftReplyInputSchema,
  getAiConfigurationInputSchema,
  operationSubscribeInputSchema,
  operationSubscribeResultSchema,
  reviewAiArtifactInputSchema,
  saveAiConfigurationInputSchema,
  summarizeConversationInputSchema,
  validateAiConfigurationInputSchema,
} from './ipc/ai.schema.js'
import { channels } from './ipc/channels.js'
import {
  commandReceiptResultSchema,
  executeCommandInputSchema,
  listCommandIssuesInputSchema,
  listCommandIssuesResultSchema,
  resolveCommandInputSchema,
} from './ipc/commands.schema.js'
import { type DesktopIpcEvent, desktopEventSchema } from './ipc/desktop-events.schema.js'
import { splitUtf8 } from './ipc/event-batching.js'
import {
  draftResultSchema,
  getDraftInputSchema,
  getDraftResultSchema,
  listDraftsInputSchema,
  listDraftsResultSchema,
  saveDraftInputSchema,
  sendDraftInputSchema,
  sendDraftResultSchema,
} from './ipc/drafts.schema.js'
import {
  conversationPageSchema,
  listConversationsInputSchema,
} from './ipc/list-conversations.schema.js'
import {
  getConversationInputSchema,
  getConversationResultSchema,
  listLabelsInputSchema,
  listLabelsResultSchema,
  searchMailInputSchema,
  searchMailResultSchema,
} from './ipc/mail.schema.js'
import {
  cancelOperationInputSchema,
  connectGmailInputSchema,
  connectGmailIpcResultSchema,
  disconnectMailboxInputSchema,
  getSyncStatusInputSchema,
  listMailboxesInputSchema,
  listMailboxesResultSchema,
  startSyncInputSchema,
  syncReceiptResultSchema,
  syncStatusResultSchema,
  voidResultSchema,
} from './ipc/mailboxes.schema.js'

const MAX_DELTA_BATCH_BYTES = 8 * 1024
const MAX_BUFFER_BYTES = 256 * 1024
const DELTA_FLUSH_MS = 16
const encoder = new TextEncoder()

type EventListener = (event: DesktopIpcEvent) => void
type EventState = {
  listeners: Set<EventListener>
  queue: DesktopIpcEvent[]
  queuedBytes: number
  timer?: ReturnType<typeof setTimeout> | undefined
  terminal: boolean
  cancelRequested: boolean
}

const eventStates = new Map<string, EventState>()

function stateFor(requestId: string): EventState {
  const existing = eventStates.get(requestId)
  if (existing) return existing
  const created: EventState = {
    listeners: new Set(),
    queue: [],
    queuedBytes: 0,
    terminal: false,
    cancelRequested: false,
  }
  eventStates.set(requestId, created)
  return created
}

function terminal(event: DesktopIpcEvent): boolean {
  return (
    event.kind === 'sync-completed' ||
    event.kind === 'sync-failed' ||
    event.kind === 'sync-cancelled' ||
    event.kind === 'ai-completed' ||
    event.kind === 'ai-failed' ||
    event.kind === 'ai-cancelled'
  )
}

function eventBytes(event: DesktopIpcEvent): number {
  return encoder.encode(event.kind === 'ai-delta' ? event.text : JSON.stringify(event)).byteLength
}

function requestCancellation(requestId: string, state: EventState): void {
  if (state.cancelRequested) return
  state.cancelRequested = true
  const parsed = cancelOperationInputSchema.parse({ requestId, operationId: requestId })
  void ipcRenderer
    .invoke(channels.cancelOperation, parsed)
    .then((result: unknown) => voidResultSchema.parse(result))
    .catch(() => {})
}

function flush(requestId: string, state: EventState): void {
  if (state.timer) clearTimeout(state.timer)
  state.timer = undefined
  if (state.listeners.size === 0) return
  const events = state.queue.splice(0)
  state.queuedBytes = 0
  for (const event of events)
    for (const listener of state.listeners)
      try {
        listener(event)
      } catch {
        requestCancellation(requestId, state)
      }
  if (state.terminal) eventStates.delete(requestId)
}

function scheduleFlush(requestId: string, state: EventState): void {
  if (state.listeners.size === 0 || state.timer) return
  state.timer = setTimeout(() => flush(requestId, state), DELTA_FLUSH_MS)
}

function enqueue(requestId: string, state: EventState, event: DesktopIpcEvent): void {
  const bytes = eventBytes(event)
  if (event.kind === 'ai-delta' && state.queuedBytes + bytes > MAX_BUFFER_BYTES) {
    requestCancellation(requestId, state)
    return
  }
  const previous = state.queue.at(-1)
  if (
    event.kind === 'ai-delta' &&
    previous?.kind === 'ai-delta' &&
    eventBytes(previous) + bytes <= MAX_DELTA_BATCH_BYTES
  )
    previous.text += event.text
  else state.queue.push(event)
  state.queuedBytes += bytes
}

ipcRenderer.on(channels.event, (_event, unknownEvent) => {
  const parsed = desktopEventSchema.safeParse(unknownEvent)
  if (!parsed.success) return
  const event = parsed.data
  const requestId = event.requestId
  const state = stateFor(requestId)
  if (event.kind === 'ai-delta')
    for (const text of splitUtf8(event.text, MAX_DELTA_BATCH_BYTES))
      enqueue(requestId, state, { ...event, text })
  else enqueue(requestId, state, event)
  if (terminal(event)) state.terminal = true
  if (event.kind !== 'ai-delta' || state.queuedBytes >= MAX_DELTA_BATCH_BYTES)
    flush(requestId, state)
  else scheduleFlush(requestId, state)
})

function subscribe(
  requestIdValue: unknown,
  mailboxIdValue: unknown,
  callbackValue: unknown,
  aiOperation: boolean,
): () => void {
  const requestId = z.string().min(1).max(200).parse(requestIdValue)
  const mailboxId = aiOperation ? z.string().min(1).max(300).parse(mailboxIdValue) : undefined
  if (typeof callbackValue !== 'function') throw new Error('Event callback must be a function')
  const callback = callbackValue as EventListener
  const state = stateFor(requestId)
  state.listeners.add(callback)
  flush(requestId, state)
  if (aiOperation && mailboxId !== undefined) {
    const failSubscription = (message: string) => {
      const event = desktopEventSchema.parse({
        kind: 'ai-failed',
        requestId,
        mailboxId,
        error: {
          code: 'AI_OPERATION_EXPIRED',
          message,
          retryable: true,
          requestId,
          userAction: 'retry',
        },
      })
      enqueue(requestId, state, event)
      state.terminal = true
      flush(requestId, state)
    }
    const input = operationSubscribeInputSchema.parse({ requestId })
    void ipcRenderer
      .invoke(channels.operationSubscribe, input)
      .then((result: unknown) => {
        const parsed = operationSubscribeResultSchema.parse(result)
        if (!parsed.ok) failSubscription(parsed.error.message)
        else if (!parsed.value) failSubscription('The AI operation expired. Try again.')
      })
      .catch(() => failSubscription('The AI operation could not start. Try again.'))
  }
  return () => {
    state.listeners.delete(callback)
    if (aiOperation && state.listeners.size === 0 && !state.terminal)
      requestCancellation(requestId, state)
    if (state.listeners.size === 0 && state.queue.length === 0) {
      if (state.timer) clearTimeout(state.timer)
      eventStates.delete(requestId)
    }
  }
}

const bridge = {
  v1: {
    async listConversations(input: unknown) {
      const parsed = listConversationsInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.listConversations, parsed)
      return conversationPageSchema.parse(result)
    },
    async listLabels(input: unknown) {
      const parsed = listLabelsInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.listLabels, parsed)
      return listLabelsResultSchema.parse(result)
    },
    async getConversation(input: unknown) {
      const parsed = getConversationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.getConversation, parsed)
      return getConversationResultSchema.parse(result)
    },
    async searchMail(input: unknown) {
      const parsed = searchMailInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.searchMail, parsed)
      return searchMailResultSchema.parse(result)
    },
    async executeCommand(input: unknown) {
      const parsed = executeCommandInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.executeCommand, parsed)
      return commandReceiptResultSchema.parse(result)
    },
    async listCommandIssues(input: unknown) {
      const parsed = listCommandIssuesInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.listCommandIssues, parsed)
      return listCommandIssuesResultSchema.parse(result)
    },
    async resolveCommand(input: unknown) {
      const parsed = resolveCommandInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.resolveCommand, parsed)
      return voidResultSchema.parse(result)
    },
    async saveDraft(input: unknown) {
      const parsed = saveDraftInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.saveDraft, parsed)
      return draftResultSchema.parse(result)
    },
    async getDraft(input: unknown) {
      const parsed = getDraftInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.getDraft, parsed)
      return getDraftResultSchema.parse(result)
    },
    async listDrafts(input: unknown) {
      const parsed = listDraftsInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.listDrafts, parsed)
      return listDraftsResultSchema.parse(result)
    },
    async sendDraft(input: unknown) {
      const parsed = sendDraftInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.sendDraft, parsed)
      return sendDraftResultSchema.parse(result)
    },
    async getAiConfiguration(input: unknown) {
      const parsed = getAiConfigurationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.getAiConfiguration, parsed)
      return aiConfigurationResultSchema.parse(result)
    },
    async saveAiConfiguration(input: unknown) {
      const parsed = saveAiConfigurationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.saveAiConfiguration, parsed)
      return aiConfigurationResultSchema.parse(result)
    },
    async clearAiConfiguration(input: unknown) {
      const parsed = clearAiConfigurationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.clearAiConfiguration, parsed)
      return voidResultSchema.parse(result)
    },
    async validateAiConfiguration(input: unknown) {
      const parsed = validateAiConfigurationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.validateAiConfiguration, parsed)
      return aiConfigurationResultSchema.parse(result)
    },
    async startConversationSummary(input: unknown) {
      const parsed = summarizeConversationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.startConversationSummary, parsed)
      return aiStreamReceiptResultSchema.parse(result)
    },
    async startReplyDraft(input: unknown) {
      const parsed = draftReplyInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.startReplyDraft, parsed)
      return aiStreamReceiptResultSchema.parse(result)
    },
    async acceptAiReply(input: unknown) {
      const parsed = acceptAiReplyInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.acceptAiReply, parsed)
      return draftResultSchema.parse(result)
    },
    async reviewAiArtifact(input: unknown) {
      const parsed = reviewAiArtifactInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.reviewAiArtifact, parsed)
      return voidResultSchema.parse(result)
    },
    async listMailboxes(input: unknown) {
      const parsed = listMailboxesInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.listMailboxes, parsed)
      return listMailboxesResultSchema.parse(result)
    },
    async connectGmail(input: unknown) {
      const parsed = connectGmailInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.connectGmail, parsed)
      return connectGmailIpcResultSchema.parse(result)
    },
    async disconnectMailbox(input: unknown) {
      const parsed = disconnectMailboxInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.disconnectMailbox, parsed)
      return voidResultSchema.parse(result)
    },
    async startSync(input: unknown) {
      const parsed = startSyncInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.startSync, parsed)
      return syncReceiptResultSchema.parse(result)
    },
    async getSyncStatus(input: unknown) {
      const parsed = getSyncStatusInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.getSyncStatus, parsed)
      return syncStatusResultSchema.parse(result)
    },
    async cancelOperation(input: unknown) {
      const parsed = cancelOperationInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.cancelOperation, parsed)
      return voidResultSchema.parse(result)
    },
    subscribe(requestId: unknown, callback: unknown) {
      return subscribe(requestId, undefined, callback, false)
    },
    subscribeOperation(requestId: unknown, mailboxId: unknown, callback: unknown) {
      return subscribe(requestId, mailboxId, callback, true)
    },
  },
}
contextBridge.exposeInMainWorld('mailrovers', bridge)
