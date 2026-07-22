import type { DurableCommand } from '@mailrovers/mail-contracts'
import {
  commandId,
  conversationId,
  draftId,
  labelId,
  mailboxId,
  messageId,
  draftRevisionFingerprint,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import {
  commandCompletionFor,
  failureTransitionFor,
  needsReviewTransitionFor,
  policyFor,
  resolveFailure,
} from '../src/command-policy.js'
import { providerHttpStatus } from '../src/provider-http-status.js'

const mailbox = mailboxId('gmail:policy')
const now = utcTimestamp('2026-07-13T00:00:00.000Z')
const draftExpectation = {
  draftId: draftId('draft'),
  expectedVersion: 3,
  outboundRevisionFingerprint: draftRevisionFingerprint('0'.repeat(64)),
}

const archivedCommand: DurableCommand = {
  kind: 'set-thread-archived',
  conversationId: conversationId('conversation'),
  archived: true,
}
const syncDraftCommand: DurableCommand = { kind: 'sync-draft', ...draftExpectation }

const commands: Array<{
  name: string
  command: DurableCommand
  policy: 'retry-safe' | 'reconcile-before-retry'
}> = [
  {
    name: 'set-thread-archived',
    command: archivedCommand,
    policy: 'retry-safe',
  },
  {
    name: 'set-thread-read',
    command: {
      kind: 'set-thread-read',
      conversationId: conversationId('conversation'),
      read: true,
    },
    policy: 'retry-safe',
  },
  {
    name: 'set-message-starred',
    command: { kind: 'set-message-starred', messageId: messageId('message'), starred: true },
    policy: 'retry-safe',
  },
  {
    name: 'set-thread-label',
    command: {
      kind: 'set-thread-label',
      conversationId: conversationId('conversation'),
      labelId: labelId('label'),
      applied: true,
    },
    policy: 'retry-safe',
  },
  {
    name: 'sync-draft',
    command: syncDraftCommand,
    policy: 'reconcile-before-retry',
  },
  {
    name: 'send-draft',
    command: { kind: 'send-draft', ...draftExpectation },
    policy: 'reconcile-before-retry',
  },
]

describe('command policy', () => {
  it.each(commands)('$name has the canonical retry policy', ({ command, policy }) => {
    expect(policyFor(command)).toEqual({ kind: policy })
  })

  it('builds mailbox-scoped completion and review transitions', () => {
    const command = syncDraftCommand
    expect(
      commandCompletionFor({
        command,
        commandId: commandId('command'),
        mailboxId: mailbox,
        result: {
          changes: {},
          sentDraftId: draftExpectation.draftId,
        },
        completedAt: now,
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      changes: {},
      expectedDraftVersion: 3,
      expectedRevisionFingerprint: draftExpectation.outboundRevisionFingerprint,
      sentDraftId: draftExpectation.draftId,
      completedAt: now,
    })
    expect(
      needsReviewTransitionFor({
        commandId: commandId('command'),
        mailboxId: mailbox,
        updatedAt: now,
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      state: 'needs_review',
      errorCode: 'AMBIGUOUS_PROVIDER_RESULT',
      errorMessage: 'Gmail may have accepted this action. Review it before retrying.',
      updatedAt: now,
    })
  })

  it('omits draft-only completion fields for set-like commands', () => {
    expect(
      commandCompletionFor({
        command: archivedCommand,
        commandId: commandId('command'),
        mailboxId: mailbox,
        result: { changes: {} },
        completedAt: now,
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      changes: {},
      completedAt: now,
    })
  })
})

describe('resolveFailure dispositions', () => {
  const retrySafe = { kind: 'retry-safe' as const }
  const reconcileBeforeRetry = { kind: 'reconcile-before-retry' as const }

  it('cancels superseded drafts', () => {
    expect(
      resolveFailure({
        error: new Error('DRAFT_SUPERSEDED'),
        policy: reconcileBeforeRetry,
        status: undefined,
        attemptCount: 1,
        requestMayHaveBeenSent: true,
      }),
    ).toEqual({ kind: 'cancelled', errorCode: 'DRAFT_SUPERSEDED' })
  })

  it('fails when the command target is gone', () => {
    expect(
      resolveFailure({
        error: Object.assign(new Error('missing'), { code: 'COMMAND_TARGET_NOT_FOUND' }),
        policy: retrySafe,
        status: undefined,
        attemptCount: 1,
        requestMayHaveBeenSent: false,
      }),
    ).toEqual({
      kind: 'failed',
      errorCode: 'COMMAND_TARGET_NOT_FOUND',
      errorMessage: 'The command target no longer exists in this mailbox.',
    })
  })

  it.each([
    {
      name: 'after the request may have been sent',
      requestMayHaveBeenSent: true,
      attemptCount: 1,
      status: undefined as number | undefined,
    },
    {
      name: 'on a retry attempt',
      requestMayHaveBeenSent: false,
      attemptCount: 2,
      status: 503 as number | undefined,
    },
    {
      name: 'when throttled after send',
      requestMayHaveBeenSent: true,
      attemptCount: 1,
      status: 429 as number | undefined,
    },
  ])(
    'reconciles ambiguous reconcile-before-retry failures $name',
    ({ requestMayHaveBeenSent, attemptCount, status }) => {
      expect(
        resolveFailure({
          error: new Error('network lost'),
          policy: reconcileBeforeRetry,
          status,
          attemptCount,
          requestMayHaveBeenSent,
        }),
      ).toEqual({ kind: 'reconcile-after-failure' })
    },
  )

  it('does not reconcile retry-safe commands on transport failure', () => {
    expect(
      resolveFailure({
        error: new Error('network lost'),
        policy: retrySafe,
        status: undefined,
        attemptCount: 1,
        requestMayHaveBeenSent: true,
      }),
    ).toEqual({
      kind: 'retry_wait',
      errorCode: 'COMMAND_RETRY',
      errorMessage: 'The change will retry when Gmail is available.',
      delayMs: 5_000,
      markAuthRequired: false,
    })
  })

  it('marks auth-required for 401', () => {
    expect(
      resolveFailure({
        error: Object.assign(new Error('unauthorized'), { status: 401 }),
        policy: retrySafe,
        status: 401,
        attemptCount: 1,
        requestMayHaveBeenSent: true,
      }),
    ).toEqual({
      kind: 'retry_wait',
      errorCode: 'AUTHENTICATION_REQUIRED',
      errorMessage: 'Gmail needs to be connected again.',
      delayMs: 5 * 60_000,
      markAuthRequired: true,
    })
  })

  it('fails on non-retryable 4xx', () => {
    expect(
      resolveFailure({
        error: Object.assign(new Error('bad request'), { status: 400 }),
        policy: retrySafe,
        status: 400,
        attemptCount: 1,
        requestMayHaveBeenSent: true,
      }),
    ).toEqual({
      kind: 'failed',
      errorCode: 'PROVIDER_REJECTED_COMMAND',
      errorMessage: 'Gmail rejected this change.',
    })
  })

  it('throttles on 429 for retry-safe commands', () => {
    expect(
      resolveFailure({
        error: Object.assign(new Error('throttled'), { status: 429 }),
        policy: retrySafe,
        status: 429,
        attemptCount: 3,
        requestMayHaveBeenSent: true,
      }),
    ).toEqual({
      kind: 'retry_wait',
      errorCode: 'PROVIDER_THROTTLED',
      errorMessage: 'The change will retry when Gmail is available.',
      delayMs: 20_000,
      markAuthRequired: false,
    })
  })

  it('builds setCommandState input from settled dispositions', () => {
    expect(
      failureTransitionFor({
        disposition: {
          kind: 'retry_wait',
          errorCode: 'COMMAND_RETRY',
          errorMessage: 'The change will retry when Gmail is available.',
          delayMs: 5_000,
          markAuthRequired: false,
        },
        commandId: commandId('command'),
        mailboxId: mailbox,
        updatedAt: now,
        nowMs: Date.parse('2026-07-13T00:00:00.000Z'),
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      state: 'retry_wait',
      nextAttemptAt: utcTimestamp('2026-07-13T00:00:05.000Z'),
      errorCode: 'COMMAND_RETRY',
      errorMessage: 'The change will retry when Gmail is available.',
      updatedAt: now,
    })
  })

  it('reads numeric provider HTTP status from errors', () => {
    expect(providerHttpStatus(Object.assign(new Error('x'), { status: 503 }))).toBe(503)
    expect(providerHttpStatus(new Error('x'))).toBeUndefined()
  })
})
