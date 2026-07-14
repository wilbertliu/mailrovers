import type { MailStore } from '@mailrovers/mail-application'
import { composeStore } from '../composition-root.js'
import type { DatabaseHost } from './database-host.js'
import { createWorkerDatabaseHost } from './worker-database-host.js'

export function createMainDatabaseHost(path: string): DatabaseHost {
  const composed = composeStore(path)
  const store = new Proxy(composed.store, {
    get(target, property, receiver) {
      if (property !== 'runPostImportMaintenance') return Reflect.get(target, property, receiver)
      const runMaintenance: MailStore['runPostImportMaintenance'] = async (input) => {
        const maintenanceHost = await createWorkerDatabaseHost(path)
        try {
          return await maintenanceHost.store.runPostImportMaintenance(input)
        } finally {
          await maintenanceHost.close()
        }
      }
      return runMaintenance
    },
  })
  return {
    store,
    subscribeCommittedChanges: (listener) => composed.subscribeCommittedChanges(listener),
    close: async () => composed.close(),
  }
}
