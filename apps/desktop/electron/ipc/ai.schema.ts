import {
  aiArtifactId,
  conversationId,
  draftId,
  mailboxId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import { applicationErrorSchema, resultSchema } from './mailboxes.schema.js'

const requestId = z.string().min(1).max(200).transform(operationId)
const mailbox = z.string().min(1).max(300).transform(mailboxId)
const conversation = z.string().min(1).max(500).transform(conversationId)
const artifactId = z.string().min(1).max(500).transform(aiArtifactId)
const draft = z.string().min(1).max(500).transform(draftId)
const instructions = z.string().max(10_000).optional()

export const aiConfigurationStatusSchema = z
  .object({
    mailboxId: mailbox,
    state: z.enum(['not_configured', 'configured', 'valid']),
    hasApiKey: z.boolean(),
    baseUrl: z.string().max(2_048).optional(),
    model: z.string().max(300).optional(),
    lastValidatedAt: z.string().datetime().transform(utcTimestamp).optional(),
  })
  .strict()

export const getAiConfigurationInputSchema = z.object({ requestId, mailboxId: mailbox }).strict()
export const saveAiConfigurationInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    baseUrl: z.string().min(1).max(2_048),
    model: z.string().min(1).max(300),
    apiKey: z.string().min(1).max(20_000).optional(),
  })
  .strict()
export const clearAiConfigurationInputSchema = getAiConfigurationInputSchema
export const validateAiConfigurationInputSchema = getAiConfigurationInputSchema

export const summarizeConversationInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    conversationId: conversation,
    sourceVersion: z.number().int().positive(),
    force: z.boolean().optional(),
    userInstructions: instructions,
  })
  .strict()
export const draftReplyInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    conversationId: conversation,
    sourceVersion: z.number().int().positive(),
    draftId: draft,
    draftVersion: z.number().int().positive(),
    userInstructions: instructions,
  })
  .strict()

export const aiStreamReceiptSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    conversationId: conversation,
    artifactType: z.enum(['conversation_summary', 'reply_draft']),
    sourceVersion: z.number().int().positive(),
  })
  .strict()

export const aiArtifactSchema = z
  .object({
    id: artifactId,
    mailboxId: mailbox,
    conversationId: conversation,
    artifactType: z.enum(['conversation_summary', 'reply_draft']),
    sourceVersion: z.number().int().positive(),
    model: z.string().min(1).max(300),
    policyVersion: z.string().min(1).max(200),
    content: z.string().max(1_048_576),
    draftId: draft.optional(),
    draftVersion: z.number().int().positive().optional(),
    recipientFingerprint: z.string().max(20_000).optional(),
    acceptedAt: z.string().datetime().transform(utcTimestamp).optional(),
    rejectedAt: z.string().datetime().transform(utcTimestamp).optional(),
    createdAt: z.string().datetime().transform(utcTimestamp),
  })
  .strict()

export const acceptAiReplyInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    artifactId,
    expectedDraftVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(300),
  })
  .strict()
export const reviewAiArtifactInputSchema = z
  .object({
    requestId,
    mailboxId: mailbox,
    artifactId,
    decision: z.literal('rejected'),
  })
  .strict()
export const operationSubscribeInputSchema = z.object({ requestId }).strict()

export const aiStreamEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ai-started'),
      requestId,
      mailboxId: mailbox,
      artifactType: z.enum(['conversation_summary', 'reply_draft']),
      sourceVersion: z.number().int().positive(),
      cached: z.boolean(),
    })
    .strict(),
  z
    .object({ kind: z.literal('ai-delta'), requestId, mailboxId: mailbox, text: z.string() })
    .strict(),
  z
    .object({
      kind: z.literal('ai-completed'),
      requestId,
      mailboxId: mailbox,
      artifact: aiArtifactSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('ai-failed'),
      requestId,
      mailboxId: mailbox,
      error: applicationErrorSchema,
    })
    .strict(),
  z.object({ kind: z.literal('ai-cancelled'), requestId, mailboxId: mailbox }).strict(),
])

export const aiConfigurationResultSchema = resultSchema(aiConfigurationStatusSchema)
export const aiStreamReceiptResultSchema = resultSchema(aiStreamReceiptSchema)
export const aiArtifactResultSchema = resultSchema(aiArtifactSchema)
export const operationSubscribeResultSchema = resultSchema(z.boolean())

export type GetAiConfigurationIpcInput = z.input<typeof getAiConfigurationInputSchema>
export type SaveAiConfigurationIpcInput = z.input<typeof saveAiConfigurationInputSchema>
export type ClearAiConfigurationIpcInput = z.input<typeof clearAiConfigurationInputSchema>
export type ValidateAiConfigurationIpcInput = z.input<typeof validateAiConfigurationInputSchema>
export type SummarizeConversationIpcInput = z.input<typeof summarizeConversationInputSchema>
export type DraftReplyIpcInput = z.input<typeof draftReplyInputSchema>
export type AcceptAiReplyIpcInput = z.input<typeof acceptAiReplyInputSchema>
export type ReviewAiArtifactIpcInput = z.input<typeof reviewAiArtifactInputSchema>
export type AiConfigurationIpcResult = z.output<typeof aiConfigurationResultSchema>
export type AiStreamReceiptIpcResult = z.output<typeof aiStreamReceiptResultSchema>
export type AiArtifactIpcResult = z.output<typeof aiArtifactResultSchema>
export type AiIpcEvent = z.output<typeof aiStreamEventSchema>
