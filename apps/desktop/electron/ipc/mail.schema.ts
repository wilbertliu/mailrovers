import {
  attachmentId,
  conversationId,
  labelId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import { resultSchema } from './mailboxes.schema.js'

const requestIdSchema = z.string().min(1).max(200).transform(operationId)
const mailboxIdSchema = z.string().min(1).max(300).transform(mailboxId)
const labelIdSchema = z.string().min(1).max(500).transform(labelId)
const conversationIdSchema = z.string().min(1).max(500).transform(conversationId)
const messageIdSchema = z.string().min(1).max(500).transform(messageId)
const attachmentIdSchema = z.string().min(1).max(500).transform(attachmentId)
const addressSchema = z
  .object({ name: z.string().max(500).optional(), address: z.string().max(1_000) })
  .strict()

export const listLabelsInputSchema = z
  .object({ requestId: requestIdSchema, mailboxId: mailboxIdSchema })
  .strict()
const labelSummarySchema = z
  .object({
    id: labelIdSchema,
    mailboxId: mailboxIdSchema,
    providerLabelId: z.string().max(500),
    name: z.string().max(1_000),
    kind: z.enum(['system', 'user']),
    color: z
      .object({ backgroundColor: z.string().optional(), textColor: z.string().optional() })
      .strict()
      .optional(),
    conversationCount: z.number().int().nonnegative(),
    unreadCount: z.number().int().nonnegative(),
  })
  .strict()
export const listLabelsResultSchema = resultSchema(z.array(labelSummarySchema))

export const getConversationInputSchema = z
  .object({
    requestId: requestIdSchema,
    mailboxId: mailboxIdSchema,
    conversationId: conversationIdSchema,
  })
  .strict()
const attachmentSchema = z
  .object({
    id: attachmentIdSchema,
    filename: z.string(),
    mediaType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    contentId: z.string().optional(),
    availability: z.enum(['remote', 'cached', 'unavailable']),
  })
  .strict()
const messageDetailSchema = z
  .object({
    id: z.string().transform(messageId),
    conversationId: conversationIdSchema,
    sender: addressSchema,
    recipients: z
      .object({
        to: z.array(addressSchema),
        cc: z.array(addressSchema),
        bcc: z.array(addressSchema),
      })
      .strict(),
    subject: z.string(),
    sentAt: z.string().datetime().transform(utcTimestamp).optional(),
    receivedAt: z.string().datetime().transform(utcTimestamp),
    bodyAvailable: z.boolean(),
    isDraft: z.boolean(),
    labelIds: z.array(labelIdSchema),
    attachments: z.array(attachmentSchema),
  })
  .strict()
const conversationDetailSchema = z
  .object({
    id: conversationIdSchema,
    mailboxId: mailboxIdSchema,
    subject: z.string(),
    version: z.number().int().positive(),
    messages: z.array(messageDetailSchema),
  })
  .strict()
export const getConversationResultSchema = resultSchema(conversationDetailSchema.nullable())

export const getMessageBodyInputSchema = z
  .object({
    requestId: requestIdSchema,
    mailboxId: mailboxIdSchema,
    conversationId: conversationIdSchema,
    messageId: messageIdSchema,
  })
  .strict()
const messageBodySchema = z
  .object({
    messageId: z.string().transform(messageId),
    textBody: z
      .string()
      .max(8 * 1024 * 1024)
      .optional(),
    sanitizedHtmlBody: z
      .string()
      .max(4 * 1024 * 1024)
      .optional(),
  })
  .strict()
  .refine((value) => value.textBody !== undefined || value.sanitizedHtmlBody !== undefined)
export const getMessageBodyResultSchema = resultSchema(messageBodySchema.nullable())

export const exportAttachmentInputSchema = z
  .object({
    requestId: requestIdSchema,
    mailboxId: mailboxIdSchema,
    messageId: messageIdSchema,
    attachmentId: attachmentIdSchema,
  })
  .strict()
export const exportAttachmentResultSchema = resultSchema(
  z
    .object({
      status: z.enum(['exported', 'cancelled']),
      attachmentId: attachmentIdSchema,
    })
    .strict(),
)

export const searchMailInputSchema = z
  .object({
    requestId: requestIdSchema,
    mailboxId: mailboxIdSchema,
    query: z.string().max(512),
    labelId: labelIdSchema.optional(),
    after: z.string().datetime().transform(utcTimestamp).optional(),
    before: z.string().datetime().transform(utcTimestamp).optional(),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict()
const searchHitSchema = z
  .object({
    messageId: z.string().transform(messageId),
    conversationId: conversationIdSchema,
    subject: z.string(),
    sender: addressSchema,
    receivedAt: z.string().datetime().transform(utcTimestamp),
    excerpt: z.string(),
    rank: z.number(),
  })
  .strict()
export const searchMailResultSchema = resultSchema(
  z
    .object({
      items: z.array(searchHitSchema),
      nextCursor: z.string().optional(),
      indexing: z.boolean(),
    })
    .strict(),
)

export type ListLabelsIpcInput = z.input<typeof listLabelsInputSchema>
export type ListLabelsIpcResult = z.output<typeof listLabelsResultSchema>
export type GetConversationIpcInput = z.input<typeof getConversationInputSchema>
export type GetConversationIpcResult = z.output<typeof getConversationResultSchema>
export type GetMessageBodyIpcInput = z.input<typeof getMessageBodyInputSchema>
export type GetMessageBodyIpcResult = z.output<typeof getMessageBodyResultSchema>
export type ExportAttachmentIpcInput = z.input<typeof exportAttachmentInputSchema>
export type ExportAttachmentIpcResult = z.output<typeof exportAttachmentResultSchema>
export type SearchMailIpcInput = z.input<typeof searchMailInputSchema>
export type SearchMailIpcResult = z.output<typeof searchMailResultSchema>
