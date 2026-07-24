import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import {
  createProcessGroupTerminatorDeps,
  isProcessGroupAlive,
  isProcessGroupAbsent,
  ProcessGroupTerminationError,
  terminateProcessGroup,
  type LeaderExitState,
} from '../perf/process-group-terminate.js'

const timedOutLeader: LeaderExitState = {
  exited: false,
  timedOut: true,
  observedAt: 0,
  exitCode: null,
  signalCode: null,
}

const exitedLeader: LeaderExitState = {
  exited: true,
  timedOut: false,
  observedAt: 0,
  exitCode: 0,
  signalCode: null,
}

describe('terminateProcessGroup', () => {
  it('treats only ESRCH from the group probe as absence', () => {
    const absent = isProcessGroupAlive(1234, () => {
      const error = new Error('no such process') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    })
    expect(absent).toBe(false)

    expect(() =>
      isProcessGroupAlive(1234, () => {
        const error = new Error('operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }),
    ).toThrow(/operation not permitted/)
  })

  it('accepts a naturally exited leader only after the group probe reports absence', async () => {
    const signals: NodeJS.Signals[] = []
    const child = { pid: 4242, exitCode: 0, signalCode: null } as ChildProcess
    const result = await terminateProcessGroup(child, {
      deps: createProcessGroupTerminatorDeps({
        waitForLeaderExit: async () => exitedLeader,
        signalGroup: (_pgid, signal) => signals.push(signal),
        isProcessGroupAlive: () => false,
      }),
    })

    expect(result.leader).toEqual(exitedLeader)
    expect(signals).toEqual([])
  })

  it('terminates a surviving descendant after its leader naturally exits', async () => {
    const signals: NodeJS.Signals[] = []
    let groupAlive = true
    const child = { pid: 7777, exitCode: 0, signalCode: null } as ChildProcess

    await terminateProcessGroup(child, {
      deps: createProcessGroupTerminatorDeps({
        waitForLeaderExit: async () => exitedLeader,
        signalGroup: (_pgid, signal) => {
          signals.push(signal)
          if (signal === 'SIGTERM') groupAlive = false
        },
        isProcessGroupAlive: () => groupAlive,
      }),
    })

    expect(signals).toEqual(['SIGTERM'])
  })

  it('continues with group cleanup when natural shutdown times out', async () => {
    const timeouts: number[] = []
    const signals: NodeJS.Signals[] = []
    let groupAlive = true
    const child = { pid: 5252, exitCode: null, signalCode: null } as ChildProcess

    await terminateProcessGroup(child, {
      naturalExitMs: 40,
      deps: createProcessGroupTerminatorDeps({
        waitForLeaderExit: async (_child, timeoutMs) => {
          timeouts.push(timeoutMs)
          return timedOutLeader
        },
        signalGroup: (_pgid, signal) => {
          signals.push(signal)
          if (signal === 'SIGTERM') groupAlive = false
        },
        isProcessGroupAlive: () => groupAlive,
      }),
    })

    expect(timeouts).toEqual([40])
    expect(signals).toEqual(['SIGTERM'])
  })

  it('escalates from SIGTERM to SIGKILL until the remaining group is absent', async () => {
    const signals: NodeJS.Signals[] = []
    let groupAlive = true
    let now = 0
    const child = { pid: 6262, exitCode: null, signalCode: null } as ChildProcess

    await terminateProcessGroup(child, {
      graceMs: 20,
      escalationMs: 20,
      pollMs: 10,
      deps: createProcessGroupTerminatorDeps({
        now: () => now,
        waitForLeaderExit: async () => timedOutLeader,
        wait: async (ms) => {
          now += ms
          if (signals.includes('SIGKILL')) groupAlive = false
        },
        signalGroup: (_pgid, signal) => signals.push(signal),
        isProcessGroupAlive: () => groupAlive,
      }),
    })

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('treats ESRCH while delivering SIGTERM as successful group absence', async () => {
    const signals: NodeJS.Signals[] = []
    let probes = 0
    const child = { pid: 7001, exitCode: null, signalCode: null } as ChildProcess

    await expect(
      terminateProcessGroup(child, {
        deps: createProcessGroupTerminatorDeps({
          waitForLeaderExit: async () => timedOutLeader,
          signalGroup: (_pgid, signal) => {
            signals.push(signal)
            const error = new Error('no such process') as NodeJS.ErrnoException
            error.code = 'ESRCH'
            throw error
          },
          isProcessGroupAlive: () => {
            probes += 1
            return true
          },
        }),
      }),
    ).resolves.toMatchObject({ pgid: 7001, leader: timedOutLeader })

    expect(signals).toEqual(['SIGTERM'])
    expect(probes).toBe(1)
  })

  it('treats ESRCH while delivering SIGKILL as successful group absence', async () => {
    const signals: NodeJS.Signals[] = []
    const child = { pid: 7002, exitCode: null, signalCode: null } as ChildProcess

    await expect(
      terminateProcessGroup(child, {
        graceMs: 0,
        deps: createProcessGroupTerminatorDeps({
          waitForLeaderExit: async () => timedOutLeader,
          signalGroup: (_pgid, signal) => {
            signals.push(signal)
            if (signal === 'SIGKILL') {
              const error = new Error('no such process') as NodeJS.ErrnoException
              error.code = 'ESRCH'
              throw error
            }
          },
          isProcessGroupAlive: () => true,
        }),
      }),
    ).resolves.toMatchObject({ pgid: 7002, leader: timedOutLeader })

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('captures non-ESRCH signal errors instead of treating the group as absent', async () => {
    const child = { pid: 7003, exitCode: null, signalCode: null } as ChildProcess
    const eperm = new Error('operation not permitted') as NodeJS.ErrnoException
    eperm.code = 'EPERM'

    await expect(
      terminateProcessGroup(child, {
        deps: createProcessGroupTerminatorDeps({
          waitForLeaderExit: async () => timedOutLeader,
          signalGroup: () => {
            throw eperm
          },
          isProcessGroupAlive: () => true,
          snapshotProcessGroup: () => ['7003 1 7003 user MailRovers'],
        }),
      }),
    ).rejects.toMatchObject({
      name: ProcessGroupTerminationError.name,
      diagnostic: {
        childPid: 7003,
        processGroupId: 7003,
        leader: timedOutLeader,
        probe: { phase: 'sigterm', errno: 'EPERM' },
        processSnapshot: ['7003 1 7003 user MailRovers'],
      },
    })
  })

  it('captures EPERM diagnostics instead of treating the group as absent', async () => {
    const child = { pid: 9001, exitCode: 0, signalCode: null } as ChildProcess
    const eperm = new Error('operation not permitted') as NodeJS.ErrnoException
    eperm.code = 'EPERM'

    await expect(
      terminateProcessGroup(child, {
        deps: createProcessGroupTerminatorDeps({
          waitForLeaderExit: async () => exitedLeader,
          isProcessGroupAlive: () => {
            throw eperm
          },
          snapshotProcessGroup: () => ['9001 1 9001 user MailRovers'],
        }),
      }),
    ).rejects.toMatchObject({
      name: ProcessGroupTerminationError.name,
      diagnostic: {
        childPid: 9001,
        processGroupId: 9001,
        leader: exitedLeader,
        probe: { phase: 'after-natural-shutdown', errno: 'EPERM' },
        processSnapshot: ['9001 1 9001 user MailRovers'],
      },
    })
  })

  it('awaits a real detached child process group until it is gone', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    expect(child.pid).toBeTypeOf('number')
    const pgid = child.pid!

    await terminateProcessGroup(child, {
      pgid,
      naturalExitMs: 20,
      graceMs: 500,
      escalationMs: 500,
      pollMs: 20,
    })
    expect(isProcessGroupAbsent(pgid)).toBe(true)
  })

  it('kills a descendant that remains after the detached leader exits', async () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
        const { spawn } = require('node:child_process');
        spawn('sleep', ['60'], { stdio: 'ignore' });
        setTimeout(() => process.exit(0), 100);
        `,
      ],
      { detached: true, stdio: 'ignore' },
    )
    expect(child.pid).toBeTypeOf('number')
    const pgid = child.pid!

    const deadline = Date.now() + 5_000
    while (child.exitCode === null && Date.now() < deadline) await delay(20)
    expect(child.exitCode).not.toBeNull()
    expect(isProcessGroupAbsent(pgid)).toBe(false)

    await terminateProcessGroup(child, { pgid, graceMs: 500, escalationMs: 500, pollMs: 20 })
    expect(isProcessGroupAbsent(pgid)).toBe(true)
  }, 15_000)
})
