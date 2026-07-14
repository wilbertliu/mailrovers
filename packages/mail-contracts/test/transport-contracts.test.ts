import {
  COMMITTED_CHANGES_REQUEST_ID,
  GMAIL_CAPABILITIES,
  stableErrorCodes,
  type ApplicationError,
  type DesktopEvent,
  type ExportAttachmentInput,
  type UndoMailCommandInput,
} from '@mailrovers/mail-contracts'
import {
  attachmentId,
  commandId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'

const mailbox = mailboxId('gmail:transport')
const request = operationId('transport-request')

function transportRoundTrip<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

describe('transport-neutral mail contracts', () => {
  it('keeps provider capabilities as complete primitive data', () => {
    expect(transportRoundTrip(GMAIL_CAPABILITIES)).toEqual({
      threadArchive: true,
      threadRead: true,
      threadLabels: true,
      messageStar: true,
      drafts: true,
      send: true,
      search: true,
      attachmentExport: true,
    })
    expect(Object.values(GMAIL_CAPABILITIES)).toEqual(Array(8).fill(true))
  })

  it('keeps stable errors and desktop events safe for a transport boundary', () => {
    const error: ApplicationError = {
      code: 'PROVIDER_THROTTLED',
      message: 'Try again later',
      retryable: true,
      requestId: request,
      userAction: 'retry',
    }
    const event: DesktopEvent = {
      kind: 'mail-changed',
      requestId: operationId(COMMITTED_CHANGES_REQUEST_ID),
      mailboxId: mailbox,
      changes: { conversations: true, outbox: true },
    }
    expect(stableErrorCodes).toContain(error.code)
    expect(transportRoundTrip(error)).toEqual(error)
    expect(transportRoundTrip(event)).toEqual(event)
  })

  it('keeps attachment export and undo inputs ownership- and path-free', () => {
    const attachment: ExportAttachmentInput = {
      requestId: request,
      mailboxId: mailbox,
      messageId: messageId('message-1'),
      attachmentId: attachmentId('attachment-1'),
    }
    const undo: UndoMailCommandInput = {
      requestId: request,
      mailboxId: mailbox,
      sourceCommandId: commandId('archive-1'),
      idempotencyKey: 'undo-archive-1',
    }
    expect(transportRoundTrip(attachment)).toEqual(attachment)
    expect(transportRoundTrip(undo)).toEqual(undo)
    expect(JSON.stringify({ attachment, undo })).not.toContain('path')
    expect(utcTimestamp('2026-07-14T00:00:00.000Z')).toBe('2026-07-14T00:00:00.000Z')
  })
})
