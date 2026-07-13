import type { MailApplication } from '@mailrovers/mail-application'
export interface DatabaseHost {
  readonly application: MailApplication
  close(): Promise<void>
}
