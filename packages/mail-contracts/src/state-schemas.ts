import type {
  ImportState,
  MailboxConnectionState,
  MailboxSyncState,
  ResumeImportState,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import type { CommandState } from './commands.js'
import type { DraftSyncState } from './drafts.js'

export const mailboxSyncStateSchema = z.enum([
  'importing',
  'paused',
  'reconciling',
  'ready',
  'auth_required',
  'failed',
])

export const mailboxConnectionStateSchema = z.enum(['connected', 'disconnected'])

export const importStateSchema = z.enum([
  'pending',
  'importing_labels',
  'importing_messages',
  'importing_drafts',
  'reconciling_history',
  'full_reconciliation',
  'paused',
  'complete',
  'failed',
])

export const resumeImportStateSchema = importStateSchema.exclude(['paused', 'failed'])

export const draftSyncStateSchema = z.enum([
  'local',
  'pending',
  'synced',
  'conflict',
  'failed',
  'sent',
])

export const commandStateSchema = z.enum([
  'pending',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'needs_review',
  'cancelled',
])

function decodeState<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
  label: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(`Invalid ${label}: ${String(value)}`)
  return parsed.data
}

export function decodeMailboxSyncState(value: unknown): MailboxSyncState {
  return decodeState(mailboxSyncStateSchema, value, 'mailbox sync state')
}

export function decodeMailboxConnectionState(value: unknown): MailboxConnectionState {
  return decodeState(mailboxConnectionStateSchema, value, 'mailbox connection state')
}

export function decodeImportState(value: unknown): ImportState {
  return decodeState(importStateSchema, value, 'import state')
}

export function decodeResumeImportState(value: unknown): ResumeImportState {
  return decodeState(resumeImportStateSchema, value, 'resume import state')
}

export function decodeDraftSyncState(value: unknown): DraftSyncState {
  return decodeState(draftSyncStateSchema, value, 'draft sync state')
}

export function decodeCommandState(value: unknown): CommandState {
  return decodeState(commandStateSchema, value, 'command state')
}
