import type { DesktopBridge } from '@mailrovers/mail-contracts'
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
  undoCommandInputSchema,
} from './ipc/commands.schema.js'
import { type DesktopIpcEvent, desktopEventSchema } from './ipc/desktop-events.schema.js'
import { PreloadEventQueue } from './preload-event-queue.js'
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
  conversationPageResultSchema,
  listConversationsInputSchema,
} from './ipc/list-conversations.schema.js'
import {
  getConversationInputSchema,
  getConversationResultSchema,
  getMessageBodyInputSchema,
  getMessageBodyResultSchema,
  exportAttachmentInputSchema,
  exportAttachmentResultSchema,
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

type EventListener = (event: DesktopIpcEvent) => void

const eventQueue = new PreloadEventQueue((requestId) => {
  const parsed = cancelOperationInputSchema.parse({ requestId, operationId: requestId })
  void ipcRenderer
    .invoke(channels.cancelOperation, parsed)
    .then((result: unknown) => voidResultSchema.parse(result))
    .catch(() => {})
})

ipcRenderer.on(channels.event, (_event, unknownEvent) => {
  const parsed = desktopEventSchema.safeParse(unknownEvent)
  if (parsed.success) eventQueue.enqueue(parsed.data)
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
  const unsubscribe = eventQueue.subscribe(requestId, callback, aiOperation)
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
      eventQueue.enqueue(event)
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
  return unsubscribe
}

const bridge = {
  v1: {
    async listConversations(input: unknown) {
      const parsed = listConversationsInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.listConversations, parsed)
      return conversationPageResultSchema.parse(result)
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
    async getMessageBody(input: unknown) {
      const parsed = getMessageBodyInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.getMessageBody, parsed)
      return getMessageBodyResultSchema.parse(result)
    },
    async exportAttachment(input: unknown) {
      const parsed = exportAttachmentInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.exportAttachment, parsed)
      return exportAttachmentResultSchema.parse(result)
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
    async undoCommand(input: unknown) {
      const parsed = undoCommandInputSchema.parse(input)
      const result: unknown = await ipcRenderer.invoke(channels.undoCommand, parsed)
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
} satisfies DesktopBridge
contextBridge.exposeInMainWorld('mailrovers', bridge)
