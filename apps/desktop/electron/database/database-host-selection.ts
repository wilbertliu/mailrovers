export type DatabaseHostKind = 'main' | 'worker'

export type DatabaseHostSelection = {
  host: DatabaseHostKind
  source: 'default' | 'environment'
}

export const DEFAULT_DATABASE_HOST: DatabaseHostKind = 'worker'

export function selectDatabaseHost(value: string | undefined): DatabaseHostSelection {
  if (value === undefined || value === '') return { host: DEFAULT_DATABASE_HOST, source: 'default' }
  if (value === 'main' || value === 'worker') return { host: value, source: 'environment' }
  throw new Error(
    `Invalid MAILROVERS_DATABASE_HOST value ${JSON.stringify(value)}; expected worker or main. Unset the variable to use worker.`,
  )
}
