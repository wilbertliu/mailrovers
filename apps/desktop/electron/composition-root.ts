import {
  createMailApplication,
  type GmailConnector,
  type MailApplication,
  type MailProviderFactory,
  type MailStore,
  type SyncEngine,
} from '@mailrovers/mail-application'
import type { DesktopEvent } from '@mailrovers/mail-contracts'
import { MailSyncEngine } from '@mailrovers/mail-sync'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { ElectronSafeStorageSecretSealer } from '@mailrovers/platform-electron'
import { shell } from 'electron'

export function composeStore(dbPath: string): { store: MailStore; close(): void } {
  const db = openDatabase(dbPath)
  migrate(db)
  return { store: new SqliteMailStore(db), close: () => db.close() }
}

function unavailableConnector(): GmailConnector {
  return {
    async authorize() {
      throw new Error('Google OAuth client ID is not configured')
    },
  }
}

function unavailableProviderFactory(): MailProviderFactory {
  return {
    async create() {
      throw new Error('Google OAuth client ID is not configured')
    },
  }
}

export function composeDesktopApplication(input: {
  store: MailStore
  publish(event: DesktopEvent): void
}): { application: MailApplication; syncEngine: SyncEngine } {
  const clientId = process.env.MAILROVERS_GOOGLE_OAUTH_CLIENT_ID
  const secretSealer = new ElectronSafeStorageSecretSealer()
  const gmailConnector: GmailConnector =
    clientId === undefined || clientId.length === 0
      ? unavailableConnector()
      : {
          async authorize(authorizationInput) {
            const { GmailOAuthConnector } = await import('@mailrovers/provider-gmail')
            return new GmailOAuthConnector({
              clientId,
              async openExternal(value) {
                const url = new URL(value)
                if (url.protocol !== 'https:') throw new Error('OAuth URL must use HTTPS')
                await shell.openExternal(url.toString())
              },
            }).authorize(authorizationInput)
          },
        }
  const providers: MailProviderFactory =
    clientId === undefined || clientId.length === 0
      ? unavailableProviderFactory()
      : {
          async create(mailboxId) {
            const { GmailProviderFactory } = await import('@mailrovers/provider-gmail')
            return new GmailProviderFactory({
              clientId,
              async getRefreshToken(id) {
                const encrypted = await input.store.getEncryptedRefreshToken(id)
                if (!encrypted) throw new Error('Gmail refresh token is unavailable')
                return secretSealer.unseal(encrypted)
              },
            }).create(mailboxId)
          },
        }
  const syncEngine = new MailSyncEngine({
    store: input.store,
    providers,
    publish: (event) => input.publish(event),
  })
  return {
    application: createMailApplication({
      store: input.store,
      gmailConnector,
      secretSealer,
      syncEngine,
    }),
    syncEngine,
  }
}
