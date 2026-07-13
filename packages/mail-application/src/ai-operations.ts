import type {
  AiArtifact,
  AiStreamEvent,
  AiStreamReceipt,
  ApplicationError,
} from '@mailrovers/mail-contracts'
import type { OperationId } from '@mailrovers/mail-domain'
import type { AiRequest, AiRuntime } from './ai-runtime.js'

const DORMANT_TIMEOUT_MS = 5_000

type Operation = {
  receipt: AiStreamReceipt
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  subscribed: boolean
  completing: boolean
  terminal: boolean
  start(): Promise<void>
}

function providerCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code
  return undefined
}

function safeAiError(error: unknown, requestId: OperationId): ApplicationError {
  if (error instanceof Error && error.name === 'AbortError')
    return {
      code: 'OPERATION_CANCELLED',
      message: 'The operation was cancelled.',
      retryable: true,
      requestId,
      userAction: 'retry',
    }
  const code = providerCode(error)
  switch (code) {
    case 'AI_AUTHENTICATION_FAILED':
      return {
        code,
        message: 'The AI provider rejected the configured API key.',
        retryable: false,
        requestId,
        userAction: 'reviewSettings',
      }
    case 'AI_PROVIDER_THROTTLED':
      return {
        code,
        message: 'The AI provider is throttling requests.',
        retryable: true,
        requestId,
        userAction: 'retry',
      }
    case 'AI_CONFIGURATION_INVALID':
      return {
        code,
        message: 'The AI provider configuration is invalid.',
        retryable: false,
        requestId,
        userAction: 'reviewSettings',
      }
    case 'AI_UNSAFE_OUTPUT':
      return {
        code,
        message: 'The AI provider returned an unsupported action.',
        retryable: false,
        requestId,
      }
    case 'AI_RESPONSE_INVALID':
    case 'AI_PROVIDER_UNAVAILABLE':
      return {
        code,
        message: 'The AI provider could not complete the request.',
        retryable: true,
        requestId,
        userAction: 'retry',
      }
    default:
      return {
        code: 'AI_PROVIDER_UNAVAILABLE',
        message: 'The AI provider could not complete the request.',
        retryable: true,
        requestId,
        userAction: 'retry',
      }
  }
}

export class AiApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AiApplicationError'
  }
}

export class AiOperationRegistry {
  private readonly operations = new Map<OperationId, Operation>()

  constructor(private readonly publish: (event: AiStreamEvent) => void) {}

  registerCached(receipt: AiStreamReceipt, artifact: AiArtifact): AiStreamReceipt {
    return this.register(receipt, async (operation) => {
      this.publish({
        kind: 'ai-started',
        requestId: receipt.requestId,
        mailboxId: receipt.mailboxId,
        artifactType: receipt.artifactType,
        sourceVersion: receipt.sourceVersion,
        cached: true,
      })
      this.publish({
        kind: 'ai-delta',
        requestId: receipt.requestId,
        mailboxId: receipt.mailboxId,
        text: artifact.content,
      })
      this.finish(operation, {
        kind: 'ai-completed',
        requestId: receipt.requestId,
        mailboxId: receipt.mailboxId,
        artifact,
      })
    })
  }

  registerRuntime(input: {
    receipt: AiStreamReceipt
    prepare(signal: AbortSignal): Promise<{ request: AiRequest; runtime: AiRuntime }>
    complete(content: string, model: string): Promise<AiArtifact>
  }): AiStreamReceipt {
    return this.register(input.receipt, async (operation) => {
      const prepared = await input.prepare(operation.controller.signal)
      if (operation.terminal || operation.controller.signal.aborted) return
      this.publish({
        kind: 'ai-started',
        requestId: input.receipt.requestId,
        mailboxId: input.receipt.mailboxId,
        artifactType: input.receipt.artifactType,
        sourceVersion: input.receipt.sourceVersion,
        cached: false,
      })
      let content = ''
      let completedModel: string | undefined
      for await (const event of prepared.runtime.stream(
        prepared.request,
        operation.controller.signal,
      )) {
        if (operation.terminal || operation.controller.signal.aborted) return
        if (event.kind === 'delta') {
          content += event.text
          this.publish({
            kind: 'ai-delta',
            requestId: input.receipt.requestId,
            mailboxId: input.receipt.mailboxId,
            text: event.text,
          })
        } else completedModel = event.model
      }
      if (operation.terminal || operation.controller.signal.aborted) return
      if (completedModel === undefined || content.trim().length === 0)
        throw new AiApplicationError('AI_RESPONSE_INVALID', 'AI provider returned no text')
      operation.completing = true
      const artifact = await input.complete(content, completedModel)
      this.finish(operation, {
        kind: 'ai-completed',
        requestId: input.receipt.requestId,
        mailboxId: input.receipt.mailboxId,
        artifact,
      })
    })
  }

  subscribe(requestId: OperationId): boolean {
    const operation = this.operations.get(requestId)
    if (!operation || operation.subscribed || operation.terminal) return false
    operation.subscribed = true
    clearTimeout(operation.timer)
    void operation.start().catch((error: unknown) => {
      if (operation.controller.signal.aborted) {
        this.finish(operation, {
          kind: 'ai-cancelled',
          requestId: operation.receipt.requestId,
          mailboxId: operation.receipt.mailboxId,
        })
        return
      }
      this.finish(operation, {
        kind: 'ai-failed',
        requestId: operation.receipt.requestId,
        mailboxId: operation.receipt.mailboxId,
        error: safeAiError(error, operation.receipt.requestId),
      })
    })
    return true
  }

  cancel(requestId: OperationId): boolean {
    const operation = this.operations.get(requestId)
    if (!operation || operation.terminal) return false
    if (operation.completing) return true
    operation.controller.abort()
    if (operation.subscribed)
      this.finish(operation, {
        kind: 'ai-cancelled',
        requestId: operation.receipt.requestId,
        mailboxId: operation.receipt.mailboxId,
      })
    else {
      clearTimeout(operation.timer)
      operation.terminal = true
      this.operations.delete(requestId)
    }
    return true
  }

  private register(
    receipt: AiStreamReceipt,
    run: (operation: Operation) => Promise<void>,
  ): AiStreamReceipt {
    if (this.operations.has(receipt.requestId))
      throw new Error('An operation with this request ID already exists')
    const operation: Operation = {
      receipt,
      controller: new AbortController(),
      subscribed: false,
      completing: false,
      terminal: false,
      timer: setTimeout(() => this.expire(receipt.requestId), DORMANT_TIMEOUT_MS),
      start: async () => run(operation),
    }
    this.operations.set(receipt.requestId, operation)
    return receipt
  }

  private expire(requestId: OperationId): void {
    const operation = this.operations.get(requestId)
    if (!operation || operation.subscribed || operation.terminal) return
    operation.terminal = true
    operation.controller.abort()
    this.operations.delete(requestId)
  }

  private finish(operation: Operation, event: AiStreamEvent): void {
    if (operation.terminal) return
    operation.terminal = true
    clearTimeout(operation.timer)
    this.operations.delete(operation.receipt.requestId)
    this.publish(event)
  }
}
