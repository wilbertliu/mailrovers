export const SERVICE_CLEANUP_DEADLINE_MS = 5_000

type ShutdownBeforeExitInput = {
  shutdownServices: readonly (() => void | Promise<void>)[]
  closeDatabase: () => void | Promise<void>
  exit: () => void
  serviceCleanupDeadlineMs?: number
}

/** Unref'd delay so the shutdown deadline cannot keep Electron alive. */
function unrefDelay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      settled = true
      resolve()
    }, ms)
    timer.unref?.()
  })
  return {
    promise,
    cancel() {
      if (settled || timer === undefined) return
      clearTimeout(timer)
      settled = true
    },
  }
}

/**
 * Let service cleanup retain database access until every task settles.
 * If the global deadline wins, leave the database open rather than racing
 * outstanding cleanup writes, then force process exit.
 */
export async function shutdownBeforeExit(input: ShutdownBeforeExitInput): Promise<void> {
  const deadline = unrefDelay(input.serviceCleanupDeadlineMs ?? SERVICE_CLEANUP_DEADLINE_MS)
  try {
    const servicesSettled = await Promise.race([
      Promise.allSettled(
        input.shutdownServices.map((shutdown) => Promise.resolve().then(shutdown)),
      ).then(() => true),
      deadline.promise.then(() => false),
    ])
    if (servicesSettled) await input.closeDatabase()
  } finally {
    deadline.cancel()
    input.exit()
  }
}
