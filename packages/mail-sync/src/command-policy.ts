import type {
  CommandStateTransition,
  MailStore,
  ProviderCommandResult,
} from '@mailrovers/mail-application'
import type { DurableCommand } from '@mailrovers/mail-contracts'
import type { CommandId, MailboxId, UtcTimestamp } from '@mailrovers/mail-domain'
import { utcTimestamp } from '@mailrovers/mail-domain'
import { providerErrorCode } from './provider-http-status.js'

export type CommandExecutionPolicy = { kind: 'retry-safe' } | { kind: 'reconcile-before-retry' }

export type CommandFailureDisposition =
  | { kind: 'cancelled'; errorCode: 'DRAFT_SUPERSEDED' }
  | {
      kind: 'failed'
      errorCode: 'COMMAND_TARGET_NOT_FOUND' | 'PROVIDER_REJECTED_COMMAND'
      errorMessage: string
    }
  | { kind: 'reconcile-after-failure' }
  | {
      kind: 'retry_wait'
      errorCode: 'AUTHENTICATION_REQUIRED' | 'PROVIDER_THROTTLED' | 'COMMAND_RETRY'
      errorMessage: string
      delayMs: number
      markAuthRequired: boolean
    }

type CompleteCommandInput = Parameters<MailStore['completeCommand']>[0]
type SettledFailureDisposition = Exclude<CommandFailureDisposition, { kind: 'reconcile-after-failure' }>

export function policyFor(command: DurableCommand): CommandExecutionPolicy {
  switch (command.kind) {
    case 'set-thread-archived':
    case 'set-thread-read':
    case 'set-message-starred':
    case 'set-thread-label':
      return { kind: 'retry-safe' }
    case 'sync-draft':
    case 'send-draft':
      return { kind: 'reconcile-before-retry' }
    default: {
      const _exhaustive: never = command
      return _exhaustive
    }
  }
}

export function resolveFailure(input: {
  error: unknown
  policy: CommandExecutionPolicy
  status: number | undefined
  attemptCount: number
  requestMayHaveBeenSent: boolean
}): CommandFailureDisposition {
  const code = providerErrorCode(input.error)
  if (input.error instanceof Error && input.error.message === 'DRAFT_SUPERSEDED') {
    return { kind: 'cancelled', errorCode: 'DRAFT_SUPERSEDED' }
  }
  if (code === 'COMMAND_TARGET_NOT_FOUND') {
    return {
      kind: 'failed',
      errorCode: 'COMMAND_TARGET_NOT_FOUND',
      errorMessage: 'The command target no longer exists in this mailbox.',
    }
  }

  const ambiguous =
    input.policy.kind === 'reconcile-before-retry' &&
    (input.requestMayHaveBeenSent || input.attemptCount > 1) &&
    (input.status === undefined || input.status >= 500 || input.status === 429)
  if (ambiguous) return { kind: 'reconcile-after-failure' }

  if (input.status === 401) {
    return {
      kind: 'retry_wait',
      errorCode: 'AUTHENTICATION_REQUIRED',
      errorMessage: 'Gmail needs to be connected again.',
      delayMs: 5 * 60_000,
      markAuthRequired: true,
    }
  }
  if (
    input.status !== undefined &&
    input.status >= 400 &&
    input.status < 500 &&
    input.status !== 429
  ) {
    return {
      kind: 'failed',
      errorCode: 'PROVIDER_REJECTED_COMMAND',
      errorMessage: 'Gmail rejected this change.',
    }
  }

  return {
    kind: 'retry_wait',
    errorCode: input.status === 429 ? 'PROVIDER_THROTTLED' : 'COMMAND_RETRY',
    errorMessage: 'The change will retry when Gmail is available.',
    delayMs: Math.min(2 ** Math.max(0, input.attemptCount - 1) * 5_000, 15 * 60_000),
    markAuthRequired: false,
  }
}

export function failureTransitionFor(input: {
  disposition: SettledFailureDisposition
  commandId: CommandId
  mailboxId: MailboxId
  updatedAt: UtcTimestamp
  nowMs: number
}): CommandStateTransition {
  switch (input.disposition.kind) {
    case 'cancelled':
      return {
        id: input.commandId,
        mailboxId: input.mailboxId,
        state: 'cancelled',
        errorCode: input.disposition.errorCode,
        updatedAt: input.updatedAt,
      }
    case 'failed':
      return {
        id: input.commandId,
        mailboxId: input.mailboxId,
        state: 'failed',
        errorCode: input.disposition.errorCode,
        errorMessage: input.disposition.errorMessage,
        updatedAt: input.updatedAt,
      }
    case 'retry_wait':
      return {
        id: input.commandId,
        mailboxId: input.mailboxId,
        state: 'retry_wait',
        nextAttemptAt: utcTimestamp(
          new Date(input.nowMs + input.disposition.delayMs).toISOString(),
        ),
        errorCode: input.disposition.errorCode,
        errorMessage: input.disposition.errorMessage,
        updatedAt: input.updatedAt,
      }
    default: {
      const _exhaustive: never = input.disposition
      return _exhaustive
    }
  }
}

export function commandCompletionFor(input: {
  command: DurableCommand
  commandId: CommandId
  mailboxId: MailboxId
  result: ProviderCommandResult
  completedAt: UtcTimestamp
}): CompleteCommandInput {
  const draftExpectation =
    input.command.kind === 'sync-draft' || input.command.kind === 'send-draft'
      ? {
          expectedDraftVersion: input.command.expectedVersion,
          expectedRevisionFingerprint: input.command.outboundRevisionFingerprint,
        }
      : {}

  return {
    id: input.commandId,
    mailboxId: input.mailboxId,
    changes: input.result.changes,
    ...draftExpectation,
    ...(input.result.draftIdentity === undefined
      ? {}
      : { draftIdentity: input.result.draftIdentity }),
    ...(input.result.sentDraftId === undefined ? {} : { sentDraftId: input.result.sentDraftId }),
    completedAt: input.completedAt,
  }
}

export function needsReviewTransitionFor(input: {
  commandId: CommandId
  mailboxId: MailboxId
  updatedAt: UtcTimestamp
}): CommandStateTransition {
  return {
    id: input.commandId,
    mailboxId: input.mailboxId,
    state: 'needs_review',
    errorCode: 'AMBIGUOUS_PROVIDER_RESULT',
    errorMessage: 'Gmail may have accepted this action. Review it before retrying.',
    updatedAt: input.updatedAt,
  }
}
