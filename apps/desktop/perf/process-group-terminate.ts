import { execFileSync, type ChildProcess } from 'node:child_process'

export const PROCESS_GROUP_NATURAL_EXIT_MS = 1_000
export const PROCESS_GROUP_TERMINATE_GRACE_MS = 2_000
export const PROCESS_GROUP_TERMINATE_ESCALATION_MS = 2_000
export const PROCESS_GROUP_TERMINATE_POLL_MS = 25

export type LeaderExitState = {
  exited: boolean
  timedOut: boolean
  observedAt: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
}

export type ProcessGroupDiagnostic = {
  childPid: number | undefined
  processGroupId: number
  leader: LeaderExitState
  probe: {
    phase: string
    at: number
    errno?: string
    message?: string
  }
  processSnapshot: string[]
}

export class ProcessGroupTerminationError extends Error {
  constructor(
    message: string,
    readonly diagnostic: ProcessGroupDiagnostic,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ProcessGroupTerminationError'
  }
}

export type ProcessGroupTerminatorDeps = {
  now(): number
  wait(ms: number): Promise<void>
  waitForLeaderExit(child: ChildProcess, timeoutMs: number): Promise<LeaderExitState>
  /** Signal every member of the process group (`kill(-pgid, signal)`). */
  signalGroup(pgid: number, signal: NodeJS.Signals): void
  /** True while any member of the process group remains. */
  isProcessGroupAlive(pgid: number): boolean
  /** Safe process metadata for a cleanup diagnostic. */
  snapshotProcessGroup(pgid: number): string[]
}

export type ProcessGroupKill = (pid: number, signal: NodeJS.Signals | 0) => void

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/**
 * Tests a complete process group with `kill(-pgid, 0)`.
 *
 * ESRCH is the only absence result. In particular, EPERM means the group is
 * present but this process cannot signal it, so callers must not continue as
 * though cleanup succeeded.
 */
export function isProcessGroupAlive(
  pgid: number,
  kill: ProcessGroupKill = (pid, signal) => process.kill(pid, signal),
): boolean {
  try {
    kill(-pgid, 0)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ESRCH')) return false
    throw error
  }
}

function defaultSignalGroup(pgid: number, signal: NodeJS.Signals): void {
  process.kill(-pgid, signal)
}

function leaderExitState(child: ChildProcess, observedAt: number): LeaderExitState | undefined {
  if (child.exitCode === null && child.signalCode === null) return undefined
  return {
    exited: true,
    timedOut: false,
    observedAt,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
  }
}

function defaultSnapshotProcessGroup(pgid: number): string[] {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,user=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return output
      .split('\n')
      .filter((line) => line.trim().split(/\s+/, 4)[2] === String(pgid))
      .map((line) => line.trim())
  } catch (error) {
    return [`snapshot failed: ${error instanceof Error ? error.message : String(error)}`]
  }
}

export function createProcessGroupTerminatorDeps(
  overrides: Partial<ProcessGroupTerminatorDeps> = {},
): ProcessGroupTerminatorDeps {
  const now = overrides.now ?? (() => Date.now())
  return {
    now,
    wait: overrides.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    waitForLeaderExit:
      overrides.waitForLeaderExit ??
      ((child, timeoutMs) =>
        new Promise((resolve) => {
          const existing = leaderExitState(child, now())
          if (existing !== undefined) {
            resolve(existing)
            return
          }
          const timer = setTimeout(() => {
            child.off('exit', onExit)
            resolve({
              exited: false,
              timedOut: true,
              observedAt: now(),
              exitCode: child.exitCode,
              signalCode: child.signalCode,
            })
          }, timeoutMs)
          const onExit = (exitCode: number | null, signalCode: NodeJS.Signals | null) => {
            clearTimeout(timer)
            resolve({ exited: true, timedOut: false, observedAt: now(), exitCode, signalCode })
          }
          child.once('exit', onExit)
        })),
    signalGroup: overrides.signalGroup ?? defaultSignalGroup,
    isProcessGroupAlive: overrides.isProcessGroupAlive ?? isProcessGroupAlive,
    snapshotProcessGroup: overrides.snapshotProcessGroup ?? defaultSnapshotProcessGroup,
  }
}

/** Detached Node children are process-group leaders; pgid === pid. */
export function resolveDetachedProcessGroupId(child: ChildProcess, pgid?: number): number {
  if (pgid !== undefined) {
    if (!Number.isInteger(pgid) || pgid <= 0) throw new Error(`Invalid process group id ${pgid}`)
    return pgid
  }
  if (!child.pid) throw new Error('Cannot terminate a process group without a pid or pgid')
  return child.pid
}

function diagnosticFor(input: {
  child: ChildProcess
  pgid: number
  leader: LeaderExitState
  phase: string
  now: number
  snapshotProcessGroup: (pgid: number) => string[]
  error?: unknown
}): ProcessGroupDiagnostic {
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === 'string'
        ? input.error
        : undefined
  const errno =
    typeof input.error === 'object' && input.error !== null && 'code' in input.error
      ? String(input.error.code)
      : undefined
  return {
    childPid: input.child.pid,
    processGroupId: input.pgid,
    leader: input.leader,
    probe: {
      phase: input.phase,
      at: input.now,
      ...(errno === undefined ? {} : { errno }),
      ...(input.error === undefined
        ? {}
        : errorMessage === undefined
          ? {}
          : { message: errorMessage }),
    },
    processSnapshot: input.snapshotProcessGroup(input.pgid),
  }
}

/**
 * Terminates an entire detached process group.
 *
 * A short natural-exit phase lets an app that has already requested shutdown
 * reap its leader before probing the group. Leader exit is never cleanup
 * success: every path still probes the negative PGID and terminates surviving
 * descendants with TERM then KILL.
 */
export async function terminateProcessGroup(
  child: ChildProcess,
  options?: {
    pgid?: number
    naturalExitMs?: number
    graceMs?: number
    escalationMs?: number
    pollMs?: number
    deps?: Partial<ProcessGroupTerminatorDeps>
  },
): Promise<{ pgid: number; leader: LeaderExitState }> {
  if (!child.pid && options?.pgid === undefined)
    return {
      pgid: 0,
      leader: {
        exited: child.exitCode !== null || child.signalCode !== null,
        timedOut: false,
        observedAt: Date.now(),
        exitCode: child.exitCode,
        signalCode: child.signalCode,
      },
    }

  const naturalExitMs = options?.naturalExitMs ?? PROCESS_GROUP_NATURAL_EXIT_MS
  const graceMs = options?.graceMs ?? PROCESS_GROUP_TERMINATE_GRACE_MS
  const escalationMs = options?.escalationMs ?? PROCESS_GROUP_TERMINATE_ESCALATION_MS
  const pollMs = options?.pollMs ?? PROCESS_GROUP_TERMINATE_POLL_MS
  const deps = createProcessGroupTerminatorDeps(options?.deps)
  const pgid = resolveDetachedProcessGroupId(child, options?.pgid)
  let leader: LeaderExitState
  try {
    leader = await deps.waitForLeaderExit(child, naturalExitMs)
  } catch (error) {
    const fallback: LeaderExitState = {
      exited: child.exitCode !== null || child.signalCode !== null,
      timedOut: false,
      observedAt: deps.now(),
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    }
    const diagnostic = diagnosticFor({
      child,
      pgid,
      leader: fallback,
      phase: 'natural-shutdown',
      now: deps.now(),
      snapshotProcessGroup: (targetPgid) => deps.snapshotProcessGroup(targetPgid),
      error,
    })
    throw new ProcessGroupTerminationError(
      `Process group ${pgid} natural shutdown failed`,
      diagnostic,
      error,
    )
  }

  const probe = (phase: string): boolean => {
    try {
      return deps.isProcessGroupAlive(pgid)
    } catch (error) {
      const diagnostic = diagnosticFor({
        child,
        pgid,
        leader,
        phase,
        now: deps.now(),
        snapshotProcessGroup: (targetPgid) => deps.snapshotProcessGroup(targetPgid),
        error,
      })
      throw new ProcessGroupTerminationError(
        `Process group ${pgid} probe failed during ${phase}`,
        diagnostic,
        error,
      )
    }
  }
  const failStillPresent = (phase: string): never => {
    const diagnostic = diagnosticFor({
      child,
      pgid,
      leader,
      phase,
      now: deps.now(),
      snapshotProcessGroup: (targetPgid) => deps.snapshotProcessGroup(targetPgid),
    })
    throw new ProcessGroupTerminationError(
      `Process group ${pgid} still present after SIGKILL escalation`,
      diagnostic,
    )
  }
  const signal = (signalName: NodeJS.Signals, phase: string): boolean => {
    try {
      deps.signalGroup(pgid, signalName)
      return false
    } catch (error) {
      if (hasErrorCode(error, 'ESRCH')) return true
      const diagnostic = diagnosticFor({
        child,
        pgid,
        leader,
        phase,
        now: deps.now(),
        snapshotProcessGroup: (targetPgid) => deps.snapshotProcessGroup(targetPgid),
        error,
      })
      throw new ProcessGroupTerminationError(
        `Process group ${pgid} ${signalName} failed during ${phase}`,
        diagnostic,
        error,
      )
    }
  }

  if (!probe('after-natural-shutdown')) return { pgid, leader }
  if (signal('SIGTERM', 'sigterm')) return { pgid, leader }
  const graceDeadline = deps.now() + graceMs
  while (probe('term-poll') && deps.now() < graceDeadline) await deps.wait(pollMs)
  if (!probe('after-sigterm')) return { pgid, leader }
  if (signal('SIGKILL', 'sigkill')) return { pgid, leader }
  const killDeadline = deps.now() + escalationMs
  while (probe('kill-poll') && deps.now() < killDeadline) await deps.wait(pollMs)
  if (probe('after-sigkill')) return failStillPresent('after-sigkill')
  return { pgid, leader }
}

export function isProcessGroupAbsent(pgid: number): boolean {
  return !isProcessGroupAlive(pgid)
}
