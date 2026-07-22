import type { MailProvider, MailProviderFactory } from '@mailrovers/mail-application'
import { workspaceId, type MailboxId } from '@mailrovers/mail-domain'
import { GmailHttpClient, RefreshTokenAccessTokenSource } from './client.js'
import type { GmailNormalizer } from './normalizer.js'
import type { GmailOAuthEndpoints } from './oauth.js'
import { GmailProvider } from './provider.js'

export class GmailProviderFactory implements MailProviderFactory {
  constructor(
    private readonly input: {
      clientId: string
      clientSecret?: string | undefined
      getRefreshToken(mailboxId: MailboxId): Promise<string>
      fetch?: typeof fetch | undefined
      endpoints?: GmailOAuthEndpoints | undefined
      now?: (() => Date) | undefined
      normalizer?: GmailNormalizer | undefined
    },
  ) {}

  async create(mailboxId: MailboxId): Promise<MailProvider> {
    const accessTokens = new RefreshTokenAccessTokenSource({
      clientId: this.input.clientId,
      ...(this.input.clientSecret === undefined ? {} : { clientSecret: this.input.clientSecret }),
      getRefreshToken: () => this.input.getRefreshToken(mailboxId),
      ...(this.input.fetch === undefined ? {} : { fetch: this.input.fetch }),
      ...(this.input.endpoints === undefined ? {} : { endpoints: this.input.endpoints }),
    })
    const client = new GmailHttpClient({
      accessTokens,
      ...(this.input.fetch === undefined ? {} : { fetch: this.input.fetch }),
      ...(this.input.endpoints === undefined ? {} : { endpoints: this.input.endpoints }),
    })
    return new GmailProvider({
      client,
      workspaceId: workspaceId('workspace-personal'),
      ...(this.input.now === undefined ? {} : { now: this.input.now }),
      ...(this.input.normalizer === undefined ? {} : { normalizer: this.input.normalizer }),
    })
  }
}
