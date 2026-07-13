import { mailboxId, operationId, utcTimestamp } from '@mailrovers/mail-domain'
import { z } from 'zod'

const requestIdSchema = z.string().min(1).max(200).transform(operationId)
const mailboxIdSchema = z.string().min(1).max(300).transform(mailboxId)

export const applicationErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    requestId: z.string().min(1).max(200),
    userAction: z.enum(['reauthenticate', 'checkNetwork', 'reviewSettings', 'retry']).optional(),
  })
  .strict()

export const mailboxSummarySchema = z
  .object({
    id: mailboxIdSchema,
    provider: z.literal('gmail'),
    emailAddress: z.string().email(),
    displayName: z.string(),
    syncState: z.enum(['importing', 'paused', 'reconciling', 'ready', 'auth_required', 'failed']),
    importedMessageCount: z.number().int().nonnegative(),
    importTotalEstimate: z.number().int().nonnegative().optional(),
    lastSuccessfulSyncAt: z.string().datetime().transform(utcTimestamp).optional(),
  })
  .strict()

export const syncStatusSchema = z
  .object({
    mailboxId: mailboxIdSchema,
    phase: z.enum([
      'idle',
      'authenticating',
      'importing_labels',
      'importing_messages',
      'importing_drafts',
      'reconciling_history',
      'paused',
      'complete',
      'failed',
      'auth_required',
    ]),
    importedMessageCount: z.number().int().nonnegative(),
    importedDraftCount: z.number().int().nonnegative(),
    totalEstimate: z.number().int().nonnegative().optional(),
    retryAt: z.string().datetime().transform(utcTimestamp).optional(),
    error: applicationErrorSchema.optional(),
  })
  .strict()

export const syncReceiptSchema = z
  .object({ requestId: requestIdSchema, mailboxId: mailboxIdSchema })
  .strict()

export const connectGmailResultSchema = z
  .object({ mailbox: mailboxSummarySchema, sync: syncReceiptSchema })
  .strict()

export const listMailboxesInputSchema = z.object({ requestId: requestIdSchema }).strict()
export const connectGmailInputSchema = z
  .object({ requestId: requestIdSchema, loginHint: z.string().email().optional() })
  .strict()
export const disconnectMailboxInputSchema = z
  .object({
    requestId: requestIdSchema,
    mailboxId: mailboxIdSchema,
    removeLocalData: z.boolean(),
  })
  .strict()
export const startSyncInputSchema = z
  .object({ requestId: requestIdSchema, mailboxId: mailboxIdSchema })
  .strict()
export const getSyncStatusInputSchema = startSyncInputSchema
export const cancelOperationInputSchema = z
  .object({ requestId: requestIdSchema, operationId: requestIdSchema })
  .strict()

export const desktopEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('sync-progress'),
      requestId: requestIdSchema,
      mailboxId: mailboxIdSchema,
      status: syncStatusSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('sync-completed'),
      requestId: requestIdSchema,
      mailboxId: mailboxIdSchema,
      status: syncStatusSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('sync-failed'),
      requestId: requestIdSchema,
      mailboxId: mailboxIdSchema,
      error: applicationErrorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('sync-cancelled'),
      requestId: requestIdSchema,
      mailboxId: mailboxIdSchema,
      status: syncStatusSchema,
    })
    .strict(),
])

function resultSchema<Value extends z.ZodTypeAny>(value: Value) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: applicationErrorSchema }).strict(),
  ])
}

export const listMailboxesResultSchema = resultSchema(z.array(mailboxSummarySchema))
export const connectGmailIpcResultSchema = resultSchema(connectGmailResultSchema)
export const voidResultSchema = resultSchema(z.null())
export const syncReceiptResultSchema = resultSchema(syncReceiptSchema)
export const syncStatusResultSchema = resultSchema(syncStatusSchema)

export type ListMailboxesIpcInput = z.input<typeof listMailboxesInputSchema>
export type ConnectGmailIpcInput = z.input<typeof connectGmailInputSchema>
export type DisconnectMailboxIpcInput = z.input<typeof disconnectMailboxInputSchema>
export type StartSyncIpcInput = z.input<typeof startSyncInputSchema>
export type GetSyncStatusIpcInput = z.input<typeof getSyncStatusInputSchema>
export type CancelOperationIpcInput = z.input<typeof cancelOperationInputSchema>
export type ListMailboxesIpcResult = z.output<typeof listMailboxesResultSchema>
export type ConnectGmailIpcResult = z.output<typeof connectGmailIpcResultSchema>
export type VoidIpcResult = z.output<typeof voidResultSchema>
export type SyncReceiptIpcResult = z.output<typeof syncReceiptResultSchema>
export type SyncStatusIpcResult = z.output<typeof syncStatusResultSchema>
export type DesktopIpcEvent = z.output<typeof desktopEventSchema>
