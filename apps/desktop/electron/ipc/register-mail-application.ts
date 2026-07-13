import type { MailApplication } from '@mailrovers/mail-application'
import type { ApplicationError } from '@mailrovers/mail-contracts'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { isAuthorizedRequest, type AuthorizedWebContents } from './authorization.js'
import { channels } from './channels.js'
import {
  commandReceiptResultSchema,
  executeCommandInputSchema,
  listCommandIssuesInputSchema,
  listCommandIssuesResultSchema,
  resolveCommandInputSchema,
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

function requestId(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  )
    return value.requestId
  return 'unknown-request'
}

function safeError(error: unknown, id: string): ApplicationError {
  if (error instanceof Error && error.name === 'AbortError')
    return {
      code: 'OPERATION_CANCELLED',
      message: 'The operation was cancelled.',
      retryable: true,
      requestId: id,
      userAction: 'retry',
    }
  if (error instanceof Error && error.message === 'DRAFT_VERSION_CONFLICT')
    return {
      code: 'DRAFT_VERSION_CONFLICT',
      message: 'This draft changed in another window. Reload it before saving again.',
      retryable: true,
      requestId: id,
      userAction: 'retry',
    }
  if (error instanceof Error && error.message.includes('client ID is not configured'))
    return {
      code: 'GMAIL_CONFIGURATION_REQUIRED',
      message: 'This build does not have a Google OAuth client ID.',
      retryable: false,
      requestId: id,
      userAction: 'reviewSettings',
    }
  return {
    code: 'APPLICATION_ERROR',
    message: 'MailRovers could not complete the request.',
    retryable: true,
    requestId: id,
    userAction: 'retry',
  }
}

function register<Input, Output>(input: {
  channel: string
  inputSchema: z.ZodType<Input, z.ZodTypeDef, unknown>
  resultSchema: z.ZodType<Output, z.ZodTypeDef, unknown>
  applicationInput: MailApplication
  webContents: AuthorizedWebContents
  rendererUrl: string
  run(application: MailApplication, value: Input): Promise<unknown>
}): void {
  ipcMain.handle(input.channel, async (event, unknownInput) => {
    if (!isAuthorizedRequest(event, input.webContents, input.rendererUrl))
      throw new Error('Unauthorized IPC request')
    const id = requestId(unknownInput)
    const parsed = input.inputSchema.safeParse(unknownInput)
    if (!parsed.success)
      return input.resultSchema.parse({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request was invalid.',
          retryable: false,
          requestId: id,
        },
      })
    try {
      const value = await input.run(input.applicationInput, parsed.data)
      return input.resultSchema.parse({ ok: true, value })
    } catch (error) {
      return input.resultSchema.parse({ ok: false, error: safeError(error, id) })
    }
  })
}

export function registerMailApplication(input: {
  application: MailApplication
  webContents: AuthorizedWebContents
  rendererUrl: string
}): void {
  const common = {
    applicationInput: input.application,
    webContents: input.webContents,
    rendererUrl: input.rendererUrl,
  }
  register({
    ...common,
    channel: channels.listMailboxes,
    inputSchema: listMailboxesInputSchema,
    resultSchema: listMailboxesResultSchema,
    run: (application, value) => application.listMailboxes(value),
  })
  register({
    ...common,
    channel: channels.listLabels,
    inputSchema: listLabelsInputSchema,
    resultSchema: listLabelsResultSchema,
    run: (application, value) => application.listLabels(value),
  })
  register({
    ...common,
    channel: channels.getConversation,
    inputSchema: getConversationInputSchema,
    resultSchema: getConversationResultSchema,
    run: async (application, value) => (await application.getConversation(value)) ?? null,
  })
  register({
    ...common,
    channel: channels.searchMail,
    inputSchema: searchMailInputSchema,
    resultSchema: searchMailResultSchema,
    run: (application, value) => application.searchMail(value),
  })
  register({
    ...common,
    channel: channels.executeCommand,
    inputSchema: executeCommandInputSchema,
    resultSchema: commandReceiptResultSchema,
    run: (application, value) => application.executeCommand(value),
  })
  register({
    ...common,
    channel: channels.listCommandIssues,
    inputSchema: listCommandIssuesInputSchema,
    resultSchema: listCommandIssuesResultSchema,
    run: (application, value) => application.listCommandIssues(value),
  })
  register({
    ...common,
    channel: channels.resolveCommand,
    inputSchema: resolveCommandInputSchema,
    resultSchema: voidResultSchema,
    run: async (application, value) => {
      await application.resolveCommand(value)
      return null
    },
  })
  register({
    ...common,
    channel: channels.saveDraft,
    inputSchema: saveDraftInputSchema,
    resultSchema: draftResultSchema,
    run: (application, value) => application.saveDraft(value),
  })
  register({
    ...common,
    channel: channels.getDraft,
    inputSchema: getDraftInputSchema,
    resultSchema: getDraftResultSchema,
    run: async (application, value) => (await application.getDraft(value)) ?? null,
  })
  register({
    ...common,
    channel: channels.listDrafts,
    inputSchema: listDraftsInputSchema,
    resultSchema: listDraftsResultSchema,
    run: (application, value) => application.listDrafts(value),
  })
  register({
    ...common,
    channel: channels.sendDraft,
    inputSchema: sendDraftInputSchema,
    resultSchema: sendDraftResultSchema,
    run: (application, value) => application.sendDraft(value),
  })
  register({
    ...common,
    channel: channels.connectGmail,
    inputSchema: connectGmailInputSchema,
    resultSchema: connectGmailIpcResultSchema,
    run: (application, value) => application.connectGmail(value),
  })
  register({
    ...common,
    channel: channels.disconnectMailbox,
    inputSchema: disconnectMailboxInputSchema,
    resultSchema: voidResultSchema,
    run: async (application, value) => {
      await application.disconnectMailbox(value)
      return null
    },
  })
  register({
    ...common,
    channel: channels.startSync,
    inputSchema: startSyncInputSchema,
    resultSchema: syncReceiptResultSchema,
    run: (application, value) => application.startSync(value),
  })
  register({
    ...common,
    channel: channels.getSyncStatus,
    inputSchema: getSyncStatusInputSchema,
    resultSchema: syncStatusResultSchema,
    run: (application, value) => application.getSyncStatus(value),
  })
  register({
    ...common,
    channel: channels.cancelOperation,
    inputSchema: cancelOperationInputSchema,
    resultSchema: voidResultSchema,
    run: async (application, value) => {
      await application.cancelOperation(value)
      return null
    },
  })
}
