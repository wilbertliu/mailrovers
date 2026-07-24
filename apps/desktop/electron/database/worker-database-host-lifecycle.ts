/** Host lifecycle from worker creation through terminal close/failure. */
export type WorkerDatabaseHostLifecycle = 'starting' | 'open' | 'closing' | 'closed' | 'failed'

export type WorkerDatabaseHostLifecycleEvent =
  | { type: 'ready' }
  | { type: 'fail'; error: Error }
  | { type: 'begin-close' }
  | { type: 'finish-close' }
  | { type: 'worker-closed-ack' }
  | { type: 'worker-exited'; code: number }

export type WorkerDatabaseHostLifecycleEffect =
  | { type: 'cancel-startup-timer' }
  | { type: 'reject-pending'; error: Error }
  | { type: 'stop-committed-changes' }
  | { type: 'resolve-startup' }
  | { type: 'reject-startup'; error: Error }
  | { type: 'request-termination' }
  | { type: 'notify-worker-closed' }

export type WorkerDatabaseHostLifecycleState = {
  phase: WorkerDatabaseHostLifecycle
  startupSettled: boolean
  closingFailure: Error | undefined
  workerExited: boolean
  workerClosedAck: boolean
}

export type WorkerDatabaseHostLifecycleReduceResult = {
  state: WorkerDatabaseHostLifecycleState
  effects: readonly WorkerDatabaseHostLifecycleEffect[]
}

const NO_EFFECTS: readonly WorkerDatabaseHostLifecycleEffect[] = Object.freeze([])

function isTerminalPhase(phase: WorkerDatabaseHostLifecycle): boolean {
  return phase === 'closed' || phase === 'failed'
}

function enterFailed(
  state: WorkerDatabaseHostLifecycleState,
  error: Error,
  options: { acknowledgeClosed: boolean },
): WorkerDatabaseHostLifecycleReduceResult {
  const effects: WorkerDatabaseHostLifecycleEffect[] = [
    { type: 'cancel-startup-timer' },
    { type: 'reject-pending', error },
    { type: 'stop-committed-changes' },
  ]
  const settleStartup = !state.startupSettled
  if (settleStartup) {
    effects.push({ type: 'reject-startup', error })
  }
  if (options.acknowledgeClosed) {
    effects.push({ type: 'notify-worker-closed' })
  }
  effects.push({ type: 'request-termination' })
  return {
    state: {
      ...state,
      phase: 'failed',
      startupSettled: settleStartup ? true : state.startupSettled,
      closingFailure: options.acknowledgeClosed ? error : state.closingFailure,
      workerClosedAck: options.acknowledgeClosed ? true : state.workerClosedAck,
    },
    effects,
  }
}

/**
 * Pure transition table for worker-database-host lifecycle.
 * Effects are applied by the controller; RPC correlation stays outside.
 */
export function reduceWorkerDatabaseHostLifecycle(
  state: WorkerDatabaseHostLifecycleState,
  event: WorkerDatabaseHostLifecycleEvent,
): WorkerDatabaseHostLifecycleReduceResult {
  switch (event.type) {
    case 'ready': {
      if (state.phase !== 'starting' || state.startupSettled) {
        return { state, effects: NO_EFFECTS }
      }
      return {
        state: { ...state, phase: 'open', startupSettled: true },
        effects: [{ type: 'cancel-startup-timer' }, { type: 'resolve-startup' }],
      }
    }
    case 'fail': {
      if (isTerminalPhase(state.phase)) return { state, effects: NO_EFFECTS }
      if (state.phase === 'closing') {
        return enterFailed(state, event.error, { acknowledgeClosed: true })
      }
      return enterFailed(state, event.error, { acknowledgeClosed: false })
    }
    case 'begin-close': {
      if (isTerminalPhase(state.phase) || state.phase === 'closing') {
        return { state, effects: NO_EFFECTS }
      }
      return {
        state: { ...state, phase: 'closing' },
        effects: NO_EFFECTS,
      }
    }
    case 'finish-close': {
      if (isTerminalPhase(state.phase)) return { state, effects: NO_EFFECTS }
      return {
        state: { ...state, phase: 'closed' },
        effects: [{ type: 'stop-committed-changes' }],
      }
    }
    case 'worker-closed-ack': {
      if (state.workerClosedAck) return { state, effects: NO_EFFECTS }
      return {
        state: { ...state, workerClosedAck: true },
        effects: [{ type: 'notify-worker-closed' }],
      }
    }
    case 'worker-exited': {
      const exited: WorkerDatabaseHostLifecycleState = { ...state, workerExited: true }
      if (isTerminalPhase(state.phase)) {
        return { state: exited, effects: NO_EFFECTS }
      }
      if (state.phase === 'closing') {
        const effects: WorkerDatabaseHostLifecycleEffect[] = [
          { type: 'reject-pending', error: new Error('Database host closed') },
        ]
        if (!state.workerClosedAck) {
          effects.unshift({ type: 'notify-worker-closed' })
        }
        return {
          state: { ...exited, workerClosedAck: true },
          effects,
        }
      }
      return reduceWorkerDatabaseHostLifecycle(exited, {
        type: 'fail',
        error: new Error(`Database worker exited with code ${event.code}`),
      })
    }
  }
}

export type WorkerDatabaseHostLifecycleHooks = {
  cancelStartupTimer(): void
  rejectPending(error: Error): void
  stopCommittedChanges(): void
  resolveStartup(): void
  rejectStartup(error: Error): void
  requestTermination(): void
  notifyWorkerClosed(): void
}

/**
 * Owns lifecycle phase + close/startup settlement flags and applies transition effects.
 * Close I/O (postMessage, drain waits, terminate await) and RPC stay on the host.
 */
export class WorkerDatabaseHostLifecycleController {
  #state: WorkerDatabaseHostLifecycleState = {
    phase: 'starting',
    startupSettled: false,
    closingFailure: undefined,
    workerExited: false,
    workerClosedAck: false,
  }
  #hooks: WorkerDatabaseHostLifecycleHooks
  #closePromise: Promise<void> | undefined

  constructor(hooks: WorkerDatabaseHostLifecycleHooks) {
    this.#hooks = hooks
  }

  get phase(): WorkerDatabaseHostLifecycle {
    return this.#state.phase
  }

  get closingFailure(): Error | undefined {
    return this.#state.closingFailure
  }

  get workerExited(): boolean {
    return this.#state.workerExited
  }

  get workerClosedAck(): boolean {
    return this.#state.workerClosedAck
  }

  get closePromise(): Promise<void> | undefined {
    return this.#closePromise
  }

  isTerminal(): boolean {
    return isTerminalPhase(this.#state.phase)
  }

  isAccepting(): boolean {
    return this.#state.phase === 'open'
  }

  isStarting(): boolean {
    return this.#state.phase === 'starting'
  }

  startupSettled(): boolean {
    return this.#state.startupSettled
  }

  dispatch(event: WorkerDatabaseHostLifecycleEvent): void {
    const result = reduceWorkerDatabaseHostLifecycle(this.#state, event)
    this.#state = result.state
    for (const effect of result.effects) this.#apply(effect)
  }

  /**
   * Idempotent close entry: shares one promise, or returns an already-terminal settle path.
   * `runClose` performs drain/ack/terminate I/O; this only owns phase + promise identity.
   */
  beginClose(runClose: () => Promise<void>, alreadyTerminal: () => Promise<void>): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise
    if (this.isTerminal()) {
      // Cache so repeated close() shares one identity even when alreadyTerminal
      // returns a fresh Promise.resolve() (e.g. exit-driven fail with no terminate).
      this.#closePromise = alreadyTerminal()
      return this.#closePromise
    }
    this.dispatch({ type: 'begin-close' })
    this.#closePromise = runClose()
    return this.#closePromise
  }

  #apply(effect: WorkerDatabaseHostLifecycleEffect): void {
    switch (effect.type) {
      case 'cancel-startup-timer':
        this.#hooks.cancelStartupTimer()
        return
      case 'reject-pending':
        this.#hooks.rejectPending(effect.error)
        return
      case 'stop-committed-changes':
        this.#hooks.stopCommittedChanges()
        return
      case 'resolve-startup':
        this.#hooks.resolveStartup()
        return
      case 'reject-startup':
        this.#hooks.rejectStartup(effect.error)
        return
      case 'request-termination':
        this.#hooks.requestTermination()
        return
      case 'notify-worker-closed':
        this.#hooks.notifyWorkerClosed()
        return
    }
  }
}
