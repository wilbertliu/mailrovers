import { describe, expect, it, vi } from 'vitest'
import {
  reduceWorkerDatabaseHostLifecycle,
  WorkerDatabaseHostLifecycleController,
  type WorkerDatabaseHostLifecycleHooks,
  type WorkerDatabaseHostLifecycleState,
} from '../electron/database/worker-database-host-lifecycle.js'

const initial = (): WorkerDatabaseHostLifecycleState => ({
  phase: 'starting',
  startupSettled: false,
  closingFailure: undefined,
  workerExited: false,
  workerClosedAck: false,
})

function openState(): WorkerDatabaseHostLifecycleState {
  return { ...initial(), phase: 'open', startupSettled: true }
}

function closingState(): WorkerDatabaseHostLifecycleState {
  return { ...initial(), phase: 'closing', startupSettled: true }
}

function createHooks(): WorkerDatabaseHostLifecycleHooks & {
  calls: { type: string; error?: Error }[]
} {
  const calls: { type: string; error?: Error }[] = []
  return {
    calls,
    cancelStartupTimer: () => calls.push({ type: 'cancel-startup-timer' }),
    rejectPending: (error) => calls.push({ type: 'reject-pending', error }),
    stopCommittedChanges: () => calls.push({ type: 'stop-committed-changes' }),
    resolveStartup: () => calls.push({ type: 'resolve-startup' }),
    rejectStartup: (error) => calls.push({ type: 'reject-startup', error }),
    requestTermination: () => calls.push({ type: 'request-termination' }),
    notifyWorkerClosed: () => calls.push({ type: 'notify-worker-closed' }),
  }
}

describe('reduceWorkerDatabaseHostLifecycle', () => {
  it('ready from starting opens and settles startup once', () => {
    const first = reduceWorkerDatabaseHostLifecycle(initial(), { type: 'ready' })
    expect(first.state).toMatchObject({ phase: 'open', startupSettled: true })
    expect(first.effects.map((effect) => effect.type)).toEqual([
      'cancel-startup-timer',
      'resolve-startup',
    ])

    const second = reduceWorkerDatabaseHostLifecycle(first.state, { type: 'ready' })
    expect(second.state).toEqual(first.state)
    expect(second.effects).toEqual([])
  })

  it('fail during starting rejects creation and terminates', () => {
    const error = new Error('boot failed')
    const result = reduceWorkerDatabaseHostLifecycle(initial(), { type: 'fail', error })
    expect(result.state).toMatchObject({
      phase: 'failed',
      startupSettled: true,
      closingFailure: undefined,
      workerClosedAck: false,
    })
    expect(result.effects.map((effect) => effect.type)).toEqual([
      'cancel-startup-timer',
      'reject-pending',
      'stop-committed-changes',
      'reject-startup',
      'request-termination',
    ])
  })

  it('fail while open does not re-reject settled startup', () => {
    const error = new Error('protocol')
    const result = reduceWorkerDatabaseHostLifecycle(openState(), { type: 'fail', error })
    expect(result.state.phase).toBe('failed')
    expect(result.effects.map((effect) => effect.type)).toEqual([
      'cancel-startup-timer',
      'reject-pending',
      'stop-committed-changes',
      'request-termination',
    ])
  })

  it('fail while closing records closingFailure and acknowledges closed', () => {
    const error = new Error('SQLITE_BUSY')
    const result = reduceWorkerDatabaseHostLifecycle(closingState(), { type: 'fail', error })
    expect(result.state).toMatchObject({
      phase: 'failed',
      closingFailure: error,
      workerClosedAck: true,
    })
    expect(result.effects.map((effect) => effect.type)).toEqual([
      'cancel-startup-timer',
      'reject-pending',
      'stop-committed-changes',
      'notify-worker-closed',
      'request-termination',
    ])
  })

  it('terminal fail is a no-op', () => {
    const failed: WorkerDatabaseHostLifecycleState = {
      ...openState(),
      phase: 'failed',
    }
    const result = reduceWorkerDatabaseHostLifecycle(failed, {
      type: 'fail',
      error: new Error('again'),
    })
    expect(result.state).toEqual(failed)
    expect(result.effects).toEqual([])
  })

  it('finish-close from closing becomes closed; finish-close after fail stays failed', () => {
    const closed = reduceWorkerDatabaseHostLifecycle(closingState(), { type: 'finish-close' })
    expect(closed.state.phase).toBe('closed')
    expect(closed.effects.map((effect) => effect.type)).toEqual(['stop-committed-changes'])

    const failed: WorkerDatabaseHostLifecycleState = {
      ...closingState(),
      phase: 'failed',
      closingFailure: new Error('SQLITE_BUSY'),
      workerClosedAck: true,
    }
    const afterFail = reduceWorkerDatabaseHostLifecycle(failed, { type: 'finish-close' })
    expect(afterFail.state).toEqual(failed)
    expect(afterFail.effects).toEqual([])
  })

  it('worker exit while closing rejects pending without failing the host', () => {
    const result = reduceWorkerDatabaseHostLifecycle(closingState(), {
      type: 'worker-exited',
      code: 0,
    })
    expect(result.state).toMatchObject({
      phase: 'closing',
      workerExited: true,
      workerClosedAck: true,
    })
    expect(result.effects).toEqual([
      { type: 'notify-worker-closed' },
      {
        type: 'reject-pending',
        error: expect.objectContaining({ message: 'Database host closed' }),
      },
    ])
  })

  it('worker exit while open fails with exit code', () => {
    const result = reduceWorkerDatabaseHostLifecycle(openState(), {
      type: 'worker-exited',
      code: 7,
    })
    expect(result.state.phase).toBe('failed')
    expect(result.state.workerExited).toBe(true)
    const failEffect = result.effects.find((effect) => effect.type === 'reject-pending')
    expect(failEffect).toMatchObject({
      type: 'reject-pending',
      error: expect.objectContaining({ message: 'Database worker exited with code 7' }),
    })
  })

  it('begin-close is ignored when already closing or terminal', () => {
    expect(
      reduceWorkerDatabaseHostLifecycle(closingState(), { type: 'begin-close' }).state.phase,
    ).toBe('closing')
    expect(
      reduceWorkerDatabaseHostLifecycle(
        { ...openState(), phase: 'closed' },
        { type: 'begin-close' },
      ).state.phase,
    ).toBe('closed')
  })
})

describe('WorkerDatabaseHostLifecycleController', () => {
  it('beginClose shares one promise and finish-close stops listeners', async () => {
    const hooks = createHooks()
    const controller = new WorkerDatabaseHostLifecycleController(hooks)
    controller.dispatch({ type: 'ready' })
    hooks.calls.length = 0

    let runs = 0
    const runClose = vi.fn<() => Promise<void>>(async () => {
      runs += 1
      controller.dispatch({ type: 'finish-close' })
    })
    const first = controller.beginClose(runClose, async () => undefined)
    const second = controller.beginClose(runClose, async () => undefined)
    expect(second).toBe(first)
    await first
    expect(runs).toBe(1)
    expect(controller.phase).toBe('closed')
    expect(hooks.calls.map((call) => call.type)).toEqual(['stop-committed-changes'])
  })

  it('beginClose after terminal uses alreadyTerminal settle path', async () => {
    const hooks = createHooks()
    const controller = new WorkerDatabaseHostLifecycleController(hooks)
    controller.dispatch({ type: 'ready' })
    controller.dispatch({ type: 'fail', error: new Error('boom') })

    const alreadyTerminal = vi.fn<() => Promise<void>>(async () => undefined)
    const runClose = vi.fn<() => Promise<void>>(async () => undefined)
    await controller.beginClose(runClose, alreadyTerminal)
    expect(runClose).not.toHaveBeenCalled()
    expect(alreadyTerminal).toHaveBeenCalledTimes(1)
  })

  it('repeated beginClose after exit-driven terminal failure shares one promise', async () => {
    const hooks = createHooks()
    const controller = new WorkerDatabaseHostLifecycleController(hooks)
    controller.dispatch({ type: 'ready' })
    controller.dispatch({ type: 'worker-exited', code: 0 })
    expect(controller.phase).toBe('failed')
    expect(controller.workerExited).toBe(true)

    // Mimic host alreadyTerminal when terminationPromise was never created.
    const alreadyTerminal = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const runClose = vi.fn<() => Promise<void>>(async () => undefined)

    const first = controller.beginClose(runClose, alreadyTerminal)
    const second = controller.beginClose(runClose, alreadyTerminal)
    expect(second).toBe(first)
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(runClose).not.toHaveBeenCalled()
    expect(alreadyTerminal).toHaveBeenCalledTimes(1)
  })

  it('close-error during close keeps rejection identity via closingFailure', async () => {
    const hooks = createHooks()
    const controller = new WorkerDatabaseHostLifecycleController(hooks)
    controller.dispatch({ type: 'ready' })

    const busy = new Error('SQLITE_BUSY')
    const runClose = async () => {
      controller.dispatch({ type: 'fail', error: busy })
      controller.dispatch({ type: 'finish-close' })
      if (controller.closingFailure !== undefined) throw controller.closingFailure
    }

    const first = controller.beginClose(runClose, async () => undefined)
    const second = controller.beginClose(runClose, async () => undefined)
    expect(second).toBe(first)
    await expect(first).rejects.toBe(busy)
    expect(controller.phase).toBe('failed')
  })
})
