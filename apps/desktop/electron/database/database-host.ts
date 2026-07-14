import type { CommittedChangeListener, MailStore } from '@mailrovers/mail-application'

export interface DatabaseHost {
  readonly store: MailStore
  subscribeCommittedChanges(listener: CommittedChangeListener): () => void
  close(): Promise<void>
}
