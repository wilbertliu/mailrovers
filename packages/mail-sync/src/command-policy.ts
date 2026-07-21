import type {
  CommandStateTransition,
  MailStore,
  ProviderCommandResult,
} from '@mailrovers/mail-application'
import type { DurableCommand } from '@mailrovers/mail-contracts'
import type { CommandId, MailboxId, UtcTimestamp } from '@mailrovers/mail-domain'

export type CommandExecutionPolicy = { kind: 'retry-safe' } | { kind: 'reconcile-before-retry' }

type CompleteCommandInput = Parameters<MailStore['completeCommand']>[0]

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
