export type DebouncedAction = {
  schedule(action: () => void): void
  cancel(): void
}

export function createDebouncedAction(delayMs: number): DebouncedAction {
  if (delayMs < 0) throw new Error('Debounce delay must not be negative')

  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    schedule(action) {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        action()
      }, delayMs)
    },
    cancel() {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}
