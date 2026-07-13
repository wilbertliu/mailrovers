import {
  commandId,
  conversationId,
  draftId,
  labelId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import { resultSchema } from './mailboxes.schema.js'

const requestId = z.string().min(1).max(200).transform(operationId)
const mailbox = z.string().min(1).max(300).transform(mailboxId)
const conversation = z.string().min(1).max(500).transform(conversationId)
const message = z.string().min(1).max(500).transform(messageId)
const draft = z.string().min(1).max(500).transform(draftId)
const label = z.string().min(1).max(500).transform(labelId)

export const mailCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('set-thread-archived'),
      conversationId: conversation,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({ kind: z.literal('set-thread-read'), conversationId: conversation, read: z.boolean() })
    .strict(),
  z
    .object({ kind: z.literal('set-message-starred'), messageId: message, starred: z.boolean() })
    .strict(),
  z
    .object({
      kind: z.literal('set-thread-label'),
      conversationId: conversation,
      labelId: label,
      applied: z.boolean(),
    })
    .strict(),
])

export const executeCommandInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    idempotencyKey: z.string().min(1).max(300),
    command: mailCommandSchema,
  })
  .strict()
const durableCommandSchema = z.discriminatedUnion('kind', [
  ...mailCommandSchema.options,
  z
    .object({ kind: z.literal('sync-draft'), draftId: draft, version: z.number().int().positive() })
    .strict(),
  z
    .object({ kind: z.literal('send-draft'), draftId: draft, version: z.number().int().positive() })
    .strict(),
])

const commandReceiptSchema = z
  .object({
    id: z.string().transform(commandId),
    mailboxId: mailbox,
    state: z.enum([
      'pending',
      'running',
      'retry_wait',
      'succeeded',
      'failed',
      'needs_review',
      'cancelled',
    ]),
    command: durableCommandSchema,
    createdAt: z.string().datetime().transform(utcTimestamp),
    nextAttemptAt: z.string().datetime().transform(utcTimestamp).optional(),
  })
  .strict()
export const commandReceiptResultSchema = resultSchema(commandReceiptSchema)

export const listCommandIssuesInputSchema = z.object({ requestId, mailboxId: mailbox }).strict()
export const listCommandIssuesResultSchema = resultSchema(z.array(commandReceiptSchema))
export const resolveCommandInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    commandId: z.string().transform(commandId),
    resolution: z.enum(['recheck', 'retry', 'cancel']),
  })
  .strict()

export type ExecuteCommandIpcInput = z.input<typeof executeCommandInputSchema>
export type CommandReceiptIpcResult = z.output<typeof commandReceiptResultSchema>
export type ListCommandIssuesIpcInput = z.input<typeof listCommandIssuesInputSchema>
export type ListCommandIssuesIpcResult = z.output<typeof listCommandIssuesResultSchema>
export type ResolveCommandIpcInput = z.input<typeof resolveCommandInputSchema>
