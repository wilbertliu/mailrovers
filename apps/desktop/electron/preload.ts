import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import { channels } from './ipc/channels.js'
import {
  commandReceiptResultSchema,
  executeCommandInputSchema,
  listCommandIssuesInputSchema,
  listCommandIssuesResultSchema,
  resolveCommandInputSchema,
} from './ipc/commands.schema.js'
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
  desktopEventSchema,
  disconnectMailboxInputSchema,
  getSyncStatusInputSchema,
  listMailboxesInputSchema,
  listMailboxesResultSchema,
  startSyncInputSchema,
  syncReceiptResultSchema,
  syncStatusResultSchema,
  voidResultSchema,
  type DesktopIpcEvent,
} from './ipc/mailboxes.schema.js'

const listeners = new Map<string, Set<(event: DesktopIpcEvent) => void>>()
const buffered = new Map<string, DesktopIpcEvent>()

ipcRenderer.on(channels.event, (_event, unknownEvent) => {
  const parsed = desktopEventSchema.safeParse(unknownEvent)
  if (!parsed.success) return
  const requestListeners = listeners.get(parsed.data.requestId)
  if (!requestListeners || requestListeners.size === 0) {
    buffered.set(parsed.data.requestId, parsed.data)
    return
  }
  for (const listener of requestListeners) listener(parsed.data)
})

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
      const parsedRequestId = z.string().min(1).max(200).parse(requestId)
      if (typeof callback !== 'function') throw new Error('Event callback must be a function')
      const listener = callback as (event: DesktopIpcEvent) => void
      const requestListeners = listeners.get(parsedRequestId) ?? new Set()
      requestListeners.add(listener)
      listeners.set(parsedRequestId, requestListeners)
      const pending = buffered.get(parsedRequestId)
      if (pending) {
        buffered.delete(parsedRequestId)
        queueMicrotask(() => listener(pending))
      }
      return () => {
        requestListeners.delete(listener)
        if (requestListeners.size === 0) listeners.delete(parsedRequestId)
      }
    },
  },
}
contextBridge.exposeInMainWorld('mailrovers', bridge)
