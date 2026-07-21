import {
  commandId,
  conversationId,
  draftId,
  draftRevisionFingerprint,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import { resultSchema } from './mailboxes.schema.js'

const requestId = z.string().min(1).max(200).transform(operationId)
const mailbox = z.string().min(1).max(300).transform(mailboxId)
const draft = z.string().min(1).max(500).transform(draftId)
export const draftMailAddressSchema = z
  .object({ name: z.string().max(500).optional(), address: z.string().email().max(1_000) })
  .strict()

export const saveDraftInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    draftId: draft.optional(),
    conversationId: z.string().transform(conversationId).optional(),
    replyToMessageId: z.string().transform(messageId).optional(),
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1).max(300),
    to: z.array(draftMailAddressSchema).max(100),
    cc: z.array(draftMailAddressSchema).max(100),
    bcc: z.array(draftMailAddressSchema).max(100),
    subject: z.string().max(2_000),
    textBody: z.string().max(20_000_000),
    htmlBody: z.string().max(20_000_000).optional(),
  })
  .strict()
export const draftSchema = z
  .object({
    id: draft,
    mailboxId: mailbox,
    conversationId: z.string().transform(conversationId).optional(),
    replyToMessageId: z.string().transform(messageId).optional(),
    providerDraftId: z.string().optional(),
    to: z.array(draftMailAddressSchema),
    cc: z.array(draftMailAddressSchema),
    bcc: z.array(draftMailAddressSchema),
    subject: z.string(),
    textBody: z.string(),
    htmlBody: z.string().optional(),
    version: z.number().int().positive(),
    revisionFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .transform(draftRevisionFingerprint),
    syncState: z.enum(['local', 'pending', 'synced', 'conflict', 'failed', 'sent']),
    updatedAt: z.string().datetime().transform(utcTimestamp),
  })
  .strict()
export const draftResultSchema = resultSchema(draftSchema)

export const getDraftInputSchema = z
  .object({ requestId, mailboxId: mailbox, draftId: draft })
  .strict()
export const getDraftResultSchema = resultSchema(draftSchema.nullable())
export const listDraftsInputSchema = z.object({ requestId, mailboxId: mailbox }).strict()
export const listDraftsResultSchema = resultSchema(z.array(draftSchema))
export const sendDraftInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    draftId: draft,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(300),
  })
  .strict()
export const sendDraftResultSchema = resultSchema(
  z
    .object({
      commandId: z.string().transform(commandId),
      draftId: draft,
      version: z.number().int().positive(),
    })
    .strict(),
)

export type SaveDraftIpcInput = z.input<typeof saveDraftInputSchema>
export type DraftIpcResult = z.output<typeof draftResultSchema>
export type GetDraftIpcInput = z.input<typeof getDraftInputSchema>
export type GetDraftIpcResult = z.output<typeof getDraftResultSchema>
export type ListDraftsIpcInput = z.input<typeof listDraftsInputSchema>
export type ListDraftsIpcResult = z.output<typeof listDraftsResultSchema>
export type SendDraftIpcInput = z.input<typeof sendDraftInputSchema>
export type SendDraftIpcResult = z.output<typeof sendDraftResultSchema>
