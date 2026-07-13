import { composeStore } from '../composition-root.js'
import type { DatabaseHost } from './database-host.js'

export function createMainDatabaseHost(path: string): DatabaseHost {
  const composed = composeStore(path)
  return { store: composed.store, close: async () => composed.close() }
}
