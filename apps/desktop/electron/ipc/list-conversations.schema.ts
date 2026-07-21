import {
  conversationId,
  labelId,
  mailboxId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import { resultSchema } from './mailboxes.schema.js'

const cursor = z.string().min(1).max(512)
export const listConversationsInputSchema = z
  .object({
    requestId: z.string().min(1).max(200).transform(operationId).optional(),
    mailboxId: z.string().min(1).max(200).transform(mailboxId),
    labelId: z.string().min(1).max(500).transform(labelId).optional(),
    unreadOnly: z.boolean().optional(),
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict()
export const conversationMailAddressSchema = z
  .object({ name: z.string().max(500).optional(), address: z.string().max(1_000) })
  .strict()

export const conversationPageSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string().transform(conversationId),
        mailboxId: z.string().transform(mailboxId),
        subject: z.string(),
        snippet: z.string(),
        senders: z.array(conversationMailAddressSchema),
        lastMessageAt: z.string().datetime().transform(utcTimestamp),
        messageCount: z.number().int().nonnegative(),
        unreadCount: z.number().int().nonnegative(),
        hasAttachments: z.boolean(),
        version: z.number().int().positive(),
      }),
    ),
    nextCursor: cursor.optional(),
  })
  .strict()
export const conversationPageResultSchema = resultSchema(conversationPageSchema)
export type ListConversationsIpcInput = z.input<typeof listConversationsInputSchema>
export type ConversationPageIpcResult = z.output<typeof conversationPageResultSchema>
