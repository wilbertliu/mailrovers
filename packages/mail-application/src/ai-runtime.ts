import type { AiArtifactType } from '@mailrovers/mail-contracts'
import type {
  ConversationId,
  DraftId,
  MailAddress,
  MailboxId,
  MessageId,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

export const SUMMARY_POLICY_VERSION = 'conversation-summary-v1'
export const REPLY_POLICY_VERSION = 'reply-draft-v1'

export type AiProviderConfiguration = {
  baseUrl: string
  model: string
  apiKey: string
}

export type AiSourceMessage = {
  id: MessageId
  sender: MailAddress
  recipients: {
    to: MailAddress[]
    cc: MailAddress[]
    bcc: MailAddress[]
  }
  sentAt?: UtcTimestamp | undefined
  receivedAt: UtcTimestamp
  text: string
}

export type AiRequest = {
  requestId: OperationId
  mailboxId: MailboxId
  conversationId: ConversationId
  artifactType: AiArtifactType
  sourceVersion: number
  policyVersion: string
  messages: AiSourceMessage[]
  contextTruncated: boolean
  userInstructions?: string | undefined
  draft?:
    | {
        id: DraftId
        version: number
        recipients: MailAddress[]
        subject: string
        textBody: string
      }
    | undefined
}

export type AiRuntimeEvent =
  | { kind: 'delta'; text: string }
  | {
      kind: 'completed'
      model: string
      finishReason?: string | undefined
      usage?:
        | {
            inputTokens?: number | undefined
            outputTokens?: number | undefined
            totalTokens?: number | undefined
          }
        | undefined
    }

export interface AiRuntime {
  stream(input: AiRequest, signal: AbortSignal): AsyncIterable<AiRuntimeEvent>
  validateConfiguration(signal: AbortSignal): Promise<void>
}

export interface AiRuntimeFactory {
  create(configuration: AiProviderConfiguration): AiRuntime
}
