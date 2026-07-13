export type AiProviderErrorCode =
  | 'AI_CONFIGURATION_INVALID'
  | 'AI_AUTHENTICATION_FAILED'
  | 'AI_PROVIDER_THROTTLED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_RESPONSE_INVALID'
  | 'AI_UNSAFE_OUTPUT'

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}
