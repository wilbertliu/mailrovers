import type { MailApplication, MailApplicationOperations } from '@mailrovers/mail-application'
import { ipcMain } from 'electron'
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
} from './ai.schema.js'
import type { AuthorizedWebContents } from './authorization.js'
import { channels } from './channels.js'
import {
  commandReceiptResultSchema,
  executeCommandInputSchema,
  listCommandIssuesInputSchema,
  listCommandIssuesResultSchema,
  resolveCommandInputSchema,
  undoCommandInputSchema,
} from './commands.schema.js'
import {
  draftResultSchema,
  getDraftInputSchema,
  getDraftResultSchema,
  listDraftsInputSchema,
  listDraftsResultSchema,
  saveDraftInputSchema,
  sendDraftInputSchema,
  sendDraftResultSchema,
} from './drafts.schema.js'
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
} from './mail.schema.js'
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
} from './mailboxes.schema.js'

import {
  conversationPageResultSchema,
  listConversationsInputSchema,
} from './list-conversations.schema.js'
import { defineValidatedHandler, registerValidatedRegistry } from './validated-handler.js'

type DesktopApplication = MailApplication & MailApplicationOperations
const defineMailIpcHandler = defineValidatedHandler<DesktopApplication>()

export const mailIpcRegistry = [
  defineMailIpcHandler({
    channel: channels.listConversations,
    inputSchema: listConversationsInputSchema,
    resultSchema: conversationPageResultSchema,
    run: (
      application: DesktopApplication,
      value: Parameters<MailApplication['listConversations']>[0],
    ) => application.listConversations(value),
  }),
  defineMailIpcHandler({
    channel: channels.listMailboxes,
    inputSchema: listMailboxesInputSchema,
    resultSchema: listMailboxesResultSchema,
    run: (application: DesktopApplication, value) => application.listMailboxes(value),
  }),
  defineMailIpcHandler({
    channel: channels.listLabels,
    inputSchema: listLabelsInputSchema,
    resultSchema: listLabelsResultSchema,
    run: (application: DesktopApplication, value) => application.listLabels(value),
  }),
  defineMailIpcHandler({
    channel: channels.getConversation,
    inputSchema: getConversationInputSchema,
    resultSchema: getConversationResultSchema,
    run: async (application: DesktopApplication, value) =>
      (await application.getConversation(value)) ?? null,
  }),
  defineMailIpcHandler({
    channel: channels.getMessageBody,
    inputSchema: getMessageBodyInputSchema,
    resultSchema: getMessageBodyResultSchema,
    run: async (application: DesktopApplication, value) =>
      (await application.getMessageBody(value)) ?? null,
  }),
  defineMailIpcHandler({
    channel: channels.exportAttachment,
    inputSchema: exportAttachmentInputSchema,
    resultSchema: exportAttachmentResultSchema,
    run: (application: DesktopApplication, value) => application.exportAttachment(value),
  }),
  defineMailIpcHandler({
    channel: channels.searchMail,
    inputSchema: searchMailInputSchema,
    resultSchema: searchMailResultSchema,
    run: (application: DesktopApplication, value) => application.searchMail(value),
  }),
  defineMailIpcHandler({
    channel: channels.executeCommand,
    inputSchema: executeCommandInputSchema,
    resultSchema: commandReceiptResultSchema,
    run: (application: DesktopApplication, value) => application.executeCommand(value),
  }),
  defineMailIpcHandler({
    channel: channels.undoCommand,
    inputSchema: undoCommandInputSchema,
    resultSchema: commandReceiptResultSchema,
    run: (application: DesktopApplication, value) => application.undoCommand(value),
  }),
  defineMailIpcHandler({
    channel: channels.listCommandIssues,
    inputSchema: listCommandIssuesInputSchema,
    resultSchema: listCommandIssuesResultSchema,
    run: (application: DesktopApplication, value) => application.listCommandIssues(value),
  }),
  defineMailIpcHandler({
    channel: channels.resolveCommand,
    inputSchema: resolveCommandInputSchema,
    resultSchema: voidResultSchema,
    run: async (application: DesktopApplication, value) => {
      await application.resolveCommand(value)
      return null
    },
  }),
  defineMailIpcHandler({
    channel: channels.saveDraft,
    inputSchema: saveDraftInputSchema,
    resultSchema: draftResultSchema,
    run: (application: DesktopApplication, value) => application.saveDraft(value),
  }),
  defineMailIpcHandler({
    channel: channels.getDraft,
    inputSchema: getDraftInputSchema,
    resultSchema: getDraftResultSchema,
    run: async (application: DesktopApplication, value) =>
      (await application.getDraft(value)) ?? null,
  }),
  defineMailIpcHandler({
    channel: channels.listDrafts,
    inputSchema: listDraftsInputSchema,
    resultSchema: listDraftsResultSchema,
    run: (application: DesktopApplication, value) => application.listDrafts(value),
  }),
  defineMailIpcHandler({
    channel: channels.sendDraft,
    inputSchema: sendDraftInputSchema,
    resultSchema: sendDraftResultSchema,
    run: (application: DesktopApplication, value) => application.sendDraft(value),
  }),
  defineMailIpcHandler({
    channel: channels.getAiConfiguration,
    inputSchema: getAiConfigurationInputSchema,
    resultSchema: aiConfigurationResultSchema,
    run: (application: DesktopApplication, value) => application.getAiConfiguration(value),
  }),
  defineMailIpcHandler({
    channel: channels.saveAiConfiguration,
    inputSchema: saveAiConfigurationInputSchema,
    resultSchema: aiConfigurationResultSchema,
    run: (application: DesktopApplication, value) => application.saveAiConfiguration(value),
  }),
  defineMailIpcHandler({
    channel: channels.clearAiConfiguration,
    inputSchema: clearAiConfigurationInputSchema,
    resultSchema: voidResultSchema,
    run: async (application: DesktopApplication, value) => {
      await application.clearAiConfiguration(value)
      return null
    },
  }),
  defineMailIpcHandler({
    channel: channels.validateAiConfiguration,
    inputSchema: validateAiConfigurationInputSchema,
    resultSchema: aiConfigurationResultSchema,
    run: (application: DesktopApplication, value) => application.validateAiConfiguration(value),
  }),
  defineMailIpcHandler({
    channel: channels.startConversationSummary,
    inputSchema: summarizeConversationInputSchema,
    resultSchema: aiStreamReceiptResultSchema,
    run: (application: DesktopApplication, value) => application.startConversationSummary(value),
  }),
  defineMailIpcHandler({
    channel: channels.startReplyDraft,
    inputSchema: draftReplyInputSchema,
    resultSchema: aiStreamReceiptResultSchema,
    run: (application: DesktopApplication, value) => application.startReplyDraft(value),
  }),
  defineMailIpcHandler({
    channel: channels.acceptAiReply,
    inputSchema: acceptAiReplyInputSchema,
    resultSchema: draftResultSchema,
    run: (application: DesktopApplication, value) => application.acceptAiReply(value),
  }),
  defineMailIpcHandler({
    channel: channels.reviewAiArtifact,
    inputSchema: reviewAiArtifactInputSchema,
    resultSchema: voidResultSchema,
    run: async (application: DesktopApplication, value) => {
      await application.reviewAiArtifact(value)
      return null
    },
  }),
  defineMailIpcHandler({
    channel: channels.operationSubscribe,
    inputSchema: operationSubscribeInputSchema,
    resultSchema: operationSubscribeResultSchema,
    run: async (application: DesktopApplication, value) =>
      application.subscribeOperation(value.requestId),
  }),
  defineMailIpcHandler({
    channel: channels.connectGmail,
    inputSchema: connectGmailInputSchema,
    resultSchema: connectGmailIpcResultSchema,
    run: (application: DesktopApplication, value) => application.connectGmail(value),
  }),
  defineMailIpcHandler({
    channel: channels.disconnectMailbox,
    inputSchema: disconnectMailboxInputSchema,
    resultSchema: voidResultSchema,
    run: async (application: DesktopApplication, value) => {
      await application.disconnectMailbox(value)
      return null
    },
  }),
  defineMailIpcHandler({
    channel: channels.startSync,
    inputSchema: startSyncInputSchema,
    resultSchema: syncReceiptResultSchema,
    run: (application: DesktopApplication, value) => application.startSync(value),
  }),
  defineMailIpcHandler({
    channel: channels.getSyncStatus,
    inputSchema: getSyncStatusInputSchema,
    resultSchema: syncStatusResultSchema,
    run: (application: DesktopApplication, value) => application.getSyncStatus(value),
  }),
  defineMailIpcHandler({
    channel: channels.cancelOperation,
    inputSchema: cancelOperationInputSchema,
    resultSchema: voidResultSchema,
    run: async (application: DesktopApplication, value) => {
      await application.cancelOperation(value)
      return null
    },
  }),
] as const

export function registerMailApplication(input: {
  application: DesktopApplication
  webContents: AuthorizedWebContents
  rendererUrl: string
}): () => void {
  return registerValidatedRegistry({
    ipcMain,
    definitions: mailIpcRegistry,
    application: input.application,
    webContents: input.webContents,
    rendererUrl: input.rendererUrl,
  })
}
