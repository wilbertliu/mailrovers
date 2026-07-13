import type { MailStore } from '@mailrovers/mail-application'

export interface DatabaseHost {
  readonly store: MailStore
  close(): Promise<void>
}
