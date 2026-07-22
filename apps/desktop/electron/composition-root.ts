import {
  AiApplicationError,
  createMailApplication,
  type AiProviderConfiguration,
  type AiRequest,
  type AiRuntime,
  type AiRuntimeEvent,
  type AiRuntimeFactory,
  type CommandDispatcher,
  type CommittedChangeListener,
  type GmailConnector,
  type MailApplication,
  type MailApplicationOperations,
  type MailProviderFactory,
  type MailStore,
  type SyncEngine,
} from '@mailrovers/mail-application'
import { COMMITTED_CHANGES_REQUEST_ID, type DesktopEvent } from '@mailrovers/mail-contracts'
import { operationId } from '@mailrovers/mail-domain'
import { MailCommandExecutor, MailSyncEngine } from '@mailrovers/mail-sync'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import {
  ElectronAttachmentStorage,
  ElectronSafeStorageSecretSealer,
} from '@mailrovers/platform-electron'
import { shell } from 'electron'
import { WorkerGmailNormalizer } from './gmail-normalizer-host.js'

export function composeStore(dbPath: string): {
  store: MailStore
  subscribeCommittedChanges(listener: CommittedChangeListener): () => void
  close(): void
} {
  const db = openDatabase(dbPath)
  migrate(db)
  const store = new SqliteMailStore(db)
  return {
    store,
    subscribeCommittedChanges: (listener) => store.subscribeCommittedChanges(listener),
    close: () => db.close(),
  }
}

function assertAiConfiguration(configuration: AiProviderConfiguration): void {
  let url: URL
  try {
    url = new URL(configuration.baseUrl)
  } catch {
    throw new AiApplicationError('AI_CONFIGURATION_INVALID', 'AI base URL is invalid')
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new AiApplicationError(
      'AI_CONFIGURATION_INVALID',
      'AI base URL must use HTTPS or loopback HTTP',
    )
  if (url.username || url.password || url.search || url.hash)
    throw new AiApplicationError('AI_CONFIGURATION_INVALID', 'AI base URL is invalid')
  if (!configuration.model || !configuration.apiKey)
    throw new AiApplicationError('AI_CONFIGURATION_INVALID', 'AI model and API key are required')
}

class LazyAiRuntime implements AiRuntime {
  constructor(private readonly configuration: AiProviderConfiguration) {}

  async *stream(input: AiRequest, signal: AbortSignal): AsyncIterable<AiRuntimeEvent> {
    const { OpenAiCompatibleRuntime } = await import('@mailrovers/mail-ai')
    const runtime = new OpenAiCompatibleRuntime(this.configuration)
    for await (const event of runtime.stream(input, signal)) yield event
  }

  async validateConfiguration(signal: AbortSignal): Promise<void> {
    const { OpenAiCompatibleRuntime } = await import('@mailrovers/mail-ai')
    await new OpenAiCompatibleRuntime(this.configuration).validateConfiguration(signal)
  }
}

class LazyAiRuntimeFactory implements AiRuntimeFactory {
  create(configuration: AiProviderConfiguration): AiRuntime {
    assertAiConfiguration(configuration)
    return new LazyAiRuntime(configuration)
  }
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

function configuredClientSecret(): string | undefined {
  const value = process.env.MAILROVERS_GOOGLE_OAUTH_CLIENT_SECRET
  return value === undefined || value.length === 0 ? undefined : value
}

export function composeDesktopApplication(input: {
  store: MailStore
  subscribeCommittedChanges(listener: CommittedChangeListener): () => void
  publish(event: DesktopEvent): void
  applicationDataRoot: string
}): {
  application: MailApplication & MailApplicationOperations
  syncEngine: SyncEngine
  commandDispatcher: CommandDispatcher
  unsubscribeCommittedChanges(): void
  shutdownNormalization(): Promise<void>
} {
  const clientId = process.env.MAILROVERS_GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = configuredClientSecret()
  const gmailNormalizer =
    clientId === undefined || clientId.length === 0 ? undefined : new WorkerGmailNormalizer()
  const secretSealer = new ElectronSafeStorageSecretSealer()
  const gmailConnector: GmailConnector =
    clientId === undefined || clientId.length === 0
      ? unavailableConnector()
      : {
          async authorize(authorizationInput) {
            const { GmailOAuthConnector } = await import('@mailrovers/provider-gmail')
            return new GmailOAuthConnector({
              clientId,
              ...(clientSecret === undefined ? {} : { clientSecret }),
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
            const mailbox = await input.store.getMailbox(mailboxId)
            if (mailbox?.connectionState !== 'connected')
              throw new Error('Mailbox is disconnected and cannot contact Gmail')
            const { GmailProviderFactory } = await import('@mailrovers/provider-gmail')
            return new GmailProviderFactory({
              clientId,
              ...(clientSecret === undefined ? {} : { clientSecret }),
              normalizer: gmailNormalizer,
              async getRefreshToken(id) {
                const encrypted = await input.store.getEncryptedRefreshToken(id)
                if (!encrypted) throw new Error('Gmail refresh token is unavailable')
                return secretSealer.unseal(encrypted)
              },
            }).create(mailboxId)
          },
        }
  const unsubscribeCommittedChanges = input.subscribeCommittedChanges((changes) =>
    input.publish({
      kind: 'mail-changed',
      requestId: operationId(COMMITTED_CHANGES_REQUEST_ID),
      ...(changes.mailboxId === undefined ? {} : { mailboxId: changes.mailboxId }),
      changes: {
        ...(changes.mailboxes ? { mailboxes: true } : {}),
        ...(changes.conversations ? { conversations: true } : {}),
        ...(changes.labels ? { labels: true } : {}),
        ...(changes.drafts ? { drafts: true } : {}),
        ...(changes.outbox ? { outbox: true } : {}),
      },
    }),
  )
  const syncEngine = new MailSyncEngine({
    store: input.store,
    providers,
    publish: (event) => input.publish(event),
  })
  const commandDispatcher = new MailCommandExecutor({ store: input.store, providers })
  commandDispatcher.wake()
  return {
    application: createMailApplication({
      store: input.store,
      gmailConnector,
      secretSealer,
      syncEngine,
      commandDispatcher,
      providers,
      attachmentStorage: new ElectronAttachmentStorage({
        applicationDataRoot: input.applicationDataRoot,
      }),
      aiRuntimeFactory: new LazyAiRuntimeFactory(),
      publishAiEvent: (event) => input.publish(event),
    }),
    syncEngine,
    commandDispatcher,
    unsubscribeCommittedChanges,
    shutdownNormalization: async () => gmailNormalizer?.shutdown(),
  }
}
