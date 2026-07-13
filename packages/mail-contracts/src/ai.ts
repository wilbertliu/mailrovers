import type {
  AiArtifactId,
  ConversationId,
  DraftId,
  MailboxId,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'
import type { ApplicationError } from './mailboxes.js'

export type AiArtifactType = 'conversation_summary' | 'reply_draft'
export type AiConfigurationState = 'not_configured' | 'configured' | 'valid'

export type AiConfigurationStatus = {
  mailboxId: MailboxId
  state: AiConfigurationState
  hasApiKey: boolean
  baseUrl?: string | undefined
  model?: string | undefined
  lastValidatedAt?: UtcTimestamp | undefined
}

export type GetAiConfigurationInput = {
  requestId: OperationId
  mailboxId: MailboxId
}

export type SaveAiConfigurationInput = {
  requestId: OperationId
  mailboxId: MailboxId
  baseUrl: string
  model: string
  apiKey?: string | undefined
}

export type ClearAiConfigurationInput = {
  requestId: OperationId
  mailboxId: MailboxId
}

export type ValidateAiConfigurationInput = {
  requestId: OperationId
  mailboxId: MailboxId
}

export type SummarizeConversationInput = {
  requestId: OperationId
  mailboxId: MailboxId
  conversationId: ConversationId
  sourceVersion: number
  force?: boolean | undefined
  userInstructions?: string | undefined
}

export type DraftReplyInput = {
  requestId: OperationId
  mailboxId: MailboxId
  conversationId: ConversationId
  sourceVersion: number
  draftId: DraftId
  draftVersion: number
  userInstructions?: string | undefined
}

export type AiStreamReceipt = {
  requestId: OperationId
  mailboxId: MailboxId
  conversationId: ConversationId
  artifactType: AiArtifactType
  sourceVersion: number
}

export type AiArtifact = {
  id: AiArtifactId
  mailboxId: MailboxId
  conversationId: ConversationId
  artifactType: AiArtifactType
  sourceVersion: number
  model: string
  policyVersion: string
  content: string
  draftId?: DraftId | undefined
  draftVersion?: number | undefined
  recipientFingerprint?: string | undefined
  acceptedAt?: UtcTimestamp | undefined
  rejectedAt?: UtcTimestamp | undefined
  createdAt: UtcTimestamp
}

export type AcceptAiReplyInput = {
  requestId: OperationId
  mailboxId: MailboxId
  artifactId: AiArtifactId
  expectedDraftVersion: number
  idempotencyKey: string
}

export type ReviewAiArtifactInput = {
  requestId: OperationId
  mailboxId: MailboxId
  artifactId: AiArtifactId
  decision: 'rejected'
}

export type AiStreamEvent =
  | {
      kind: 'ai-started'
      requestId: OperationId
      mailboxId: MailboxId
      artifactType: AiArtifactType
      sourceVersion: number
      cached: boolean
    }
  | {
      kind: 'ai-delta'
      requestId: OperationId
      mailboxId: MailboxId
      text: string
    }
  | {
      kind: 'ai-completed'
      requestId: OperationId
      mailboxId: MailboxId
      artifact: AiArtifact
    }
  | {
      kind: 'ai-failed'
      requestId: OperationId
      mailboxId: MailboxId
      error: ApplicationError
    }
  | {
      kind: 'ai-cancelled'
      requestId: OperationId
      mailboxId: MailboxId
    }
