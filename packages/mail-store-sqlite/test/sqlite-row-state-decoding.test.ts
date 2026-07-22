import {
  decodeCommandState,
  decodeDraftSyncState,
  decodeImportState,
  decodeMailboxConnectionState,
  decodeMailboxSyncState,
  decodeResumeImportState,
} from '@mailrovers/mail-contracts'
import { describe, expect, it } from 'vitest'
import {
  mapCheckpoint,
  mapCommand,
  mapDraft,
  mapMailbox,
} from '../src/sqlite-row-helpers.js'

const mailboxId = 'gmail:test-mailbox'
const workspaceId = 'workspace:test'
const now = '2026-01-01T00:00:00.000Z'

describe('SQLite row state decoding', () => {
  it('rejects invalid mailbox sync and connection states', () => {
    expect(() => decodeMailboxSyncState('bogus')).toThrow(/Invalid mailbox sync state/)
    expect(() => decodeMailboxConnectionState('half-open')).toThrow(
      /Invalid mailbox connection state/,
    )
    expect(() =>
      mapMailbox({
        id: mailboxId,
        workspace_id: workspaceId,
        provider_account_id: 'acct',
        email_address: 'a@example.com',
        display_name: 'A',
        sync_state: 'not-a-state',
        connection_state: 'connected',
        created_at: now,
        updated_at: now,
      }),
    ).toThrow(/Invalid mailbox sync state/)
  })

  it('rejects invalid import and resume import states', () => {
    expect(() => decodeImportState('done')).toThrow(/Invalid import state/)
    expect(() => decodeResumeImportState('paused')).toThrow(/Invalid resume import state/)
    expect(() => decodeResumeImportState('failed')).toThrow(/Invalid resume import state/)
    expect(() =>
      mapCheckpoint({
        mailbox_id: mailboxId,
        import_state: 'still_going',
        imported_message_count: 0,
        imported_draft_count: 0,
        sync_failure_count: 0,
        updated_at: now,
      }),
    ).toThrow(/Invalid import state/)
    expect(() =>
      mapCheckpoint({
        mailbox_id: mailboxId,
        import_state: 'paused',
        resume_import_state: 'failed',
        imported_message_count: 0,
        imported_draft_count: 0,
        sync_failure_count: 0,
        updated_at: now,
      }),
    ).toThrow(/Invalid resume import state/)
  })

  it('rejects invalid draft and command states', () => {
    expect(() => decodeDraftSyncState('queued')).toThrow(/Invalid draft sync state/)
    expect(() => decodeCommandState('stuck')).toThrow(/Invalid command state/)
    expect(() =>
      mapDraft({
        id: 'draft:1',
        mailbox_id: mailboxId,
        to_json: '[]',
        cc_json: '[]',
        bcc_json: '[]',
        subject: 's',
        text_body: 't',
        version: 1,
        revision_fingerprint: 'a'.repeat(64),
        sync_state: 'mystery',
        updated_at: now,
      }),
    ).toThrow(/Invalid draft sync state/)
    expect(() =>
      mapCommand({
        id: 'command:1',
        mailbox_id: mailboxId,
        state: 'unknown',
        payload_json: JSON.stringify({
          kind: 'set-thread-read',
          conversationId: 'conversation:1',
          read: true,
        }),
        created_at: now,
      }),
    ).toThrow(/Invalid command state/)
  })

  it('accepts canonical state values', () => {
    expect(decodeMailboxSyncState('ready')).toBe('ready')
    expect(decodeMailboxConnectionState('disconnected')).toBe('disconnected')
    expect(decodeImportState('importing_messages')).toBe('importing_messages')
    expect(decodeResumeImportState('complete')).toBe('complete')
    expect(decodeDraftSyncState('synced')).toBe('synced')
    expect(decodeCommandState('succeeded')).toBe('succeeded')
  })
})
