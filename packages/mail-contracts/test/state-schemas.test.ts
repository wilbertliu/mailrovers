import {
  commandStateSchema,
  decodeImportState,
  decodeResumeImportState,
  draftSyncStateSchema,
  importStateSchema,
  mailboxConnectionStateSchema,
  mailboxSyncStateSchema,
  resumeImportStateSchema,
} from '@mailrovers/mail-contracts'
import { describe, expect, it } from 'vitest'

describe('shared mail state schemas', () => {
  it('parses the domain mailbox and import enums', () => {
    expect(mailboxSyncStateSchema.parse('ready')).toBe('ready')
    expect(mailboxConnectionStateSchema.parse('connected')).toBe('connected')
    expect(importStateSchema.parse('complete')).toBe('complete')
    expect(resumeImportStateSchema.parse('pending')).toBe('pending')
    expect(draftSyncStateSchema.parse('local')).toBe('local')
    expect(commandStateSchema.parse('pending')).toBe('pending')
  })

  it('rejects terminal resume states and unknown values', () => {
    expect(resumeImportStateSchema.safeParse('paused').success).toBe(false)
    expect(resumeImportStateSchema.safeParse('failed').success).toBe(false)
    expect(() => decodeImportState('nope')).toThrow(/Invalid import state/)
    expect(() => decodeResumeImportState('paused')).toThrow(/Invalid resume import state/)
  })
})
