import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import { channels } from './ipc/channels.js'
import {
  conversationPageSchema,
  listConversationsInputSchema,
} from './ipc/list-conversations.schema.js'
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
