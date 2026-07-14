import { z } from 'zod'

export const gmailAttachmentSchema = z
  .object({
    size: z.number().int().nonnegative(),
    data: z.string().regex(/^[A-Za-z0-9_-]*={0,2}$/),
  })
  .passthrough()

const headerSchema = z.object({ name: z.string(), value: z.string() }).passthrough()

export type GmailMessagePart = {
  partId?: string | undefined
  mimeType?: string | undefined
  filename?: string | undefined
  headers?: Array<{ name: string; value: string }> | undefined
  body?: {
    attachmentId?: string | undefined
    size?: number | undefined
    data?: string | undefined
  }
  parts?: GmailMessagePart[] | undefined
}

export const messagePartSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      partId: z.string().optional(),
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      headers: z.array(headerSchema).optional(),
      body: z
        .object({
          attachmentId: z.string().optional(),
          size: z.number().int().nonnegative().optional(),
          data: z.string().optional(),
        })
        .optional(),
      parts: z.array(messagePartSchema).optional(),
    })
    .passthrough(),
)

export const gmailMessageSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    labelIds: z.array(z.string()).default([]),
    snippet: z.string().default(''),
    historyId: z.string().optional(),
    internalDate: z.string().regex(/^\d+$/),
    payload: messagePartSchema,
    sizeEstimate: z.number().int().nonnegative().default(0),
  })
  .passthrough()

export type GmailMessage = {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  historyId?: string | undefined
  internalDate: string
  payload: GmailMessagePart
  sizeEstimate: number
}

export function parseGmailMessage(value: unknown): GmailMessage {
  const parsed = gmailMessageSchema.parse(value)
  return {
    id: parsed.id,
    threadId: parsed.threadId,
    labelIds: parsed.labelIds,
    snippet: parsed.snippet,
    ...(parsed.historyId === undefined ? {} : { historyId: parsed.historyId }),
    internalDate: parsed.internalDate,
    payload: parsed.payload as GmailMessagePart,
    sizeEstimate: parsed.sizeEstimate,
  }
}

export const gmailThreadSchema = z
  .object({
    id: z.string().min(1),
    historyId: z.string().optional(),
    messages: z.array(gmailMessageSchema).default([]),
  })
  .passthrough()

export const listMessagesSchema = z
  .object({
    messages: z.array(z.object({ id: z.string(), threadId: z.string() }).passthrough()).default([]),
    nextPageToken: z.string().optional(),
    resultSizeEstimate: z.number().int().nonnegative().optional(),
  })
  .passthrough()

export const gmailLabelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['system', 'user']),
    color: z
      .object({ backgroundColor: z.string().optional(), textColor: z.string().optional() })
      .optional(),
  })
  .passthrough()

export const listLabelsSchema = z
  .object({ labels: z.array(gmailLabelSchema).default([]) })
  .passthrough()

export const gmailDraftSchema = z
  .object({ id: z.string(), message: gmailMessageSchema })
  .passthrough()

export type GmailDraft = { id: string; message: GmailMessage }

export function parseGmailDraft(value: unknown): GmailDraft {
  const parsed = gmailDraftSchema.parse(value)
  return { id: parsed.id, message: parseGmailMessage(parsed.message) }
}

export const listDraftsSchema = z
  .object({
    drafts: z
      .array(
        z
          .object({
            id: z.string(),
            message: z.object({ id: z.string(), threadId: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .default([]),
    nextPageToken: z.string().optional(),
    resultSizeEstimate: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const historyMessageSchema = z.object({ id: z.string(), threadId: z.string() }).passthrough()
const historyEntrySchema = z
  .object({
    id: z.string(),
    messagesAdded: z.array(z.object({ message: historyMessageSchema }).passthrough()).optional(),
    messagesDeleted: z.array(z.object({ message: historyMessageSchema }).passthrough()).optional(),
    labelsAdded: z
      .array(
        z.object({ message: historyMessageSchema, labelIds: z.array(z.string()) }).passthrough(),
      )
      .optional(),
    labelsRemoved: z
      .array(
        z.object({ message: historyMessageSchema, labelIds: z.array(z.string()) }).passthrough(),
      )
      .optional(),
  })
  .passthrough()

export const historyResponseSchema = z
  .object({
    history: z.array(historyEntrySchema).default([]),
    nextPageToken: z.string().optional(),
    historyId: z.string(),
  })
  .passthrough()

export const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().positive(),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
  })
  .passthrough()

export const tokenInfoSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().email(),
    email_verified: z.union([z.literal('true'), z.literal(true)]).optional(),
    aud: z.string(),
  })
  .passthrough()

export const profileSchema = z
  .object({ emailAddress: z.string().email(), historyId: z.string() })
  .passthrough()
