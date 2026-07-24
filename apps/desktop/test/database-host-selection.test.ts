import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATABASE_HOST,
  selectDatabaseHost,
} from '../electron/database/database-host-selection.js'

describe('selectDatabaseHost', () => {
  it('uses worker when MAILROVERS_DATABASE_HOST is unset or empty', () => {
    expect(DEFAULT_DATABASE_HOST).toBe('worker')
    expect(selectDatabaseHost(undefined)).toEqual({ host: 'worker', source: 'default' })
    expect(selectDatabaseHost('')).toEqual({ host: 'worker', source: 'default' })
  })

  it('accepts explicit worker and main selections', () => {
    expect(selectDatabaseHost('worker')).toEqual({ host: 'worker', source: 'environment' })
    expect(selectDatabaseHost('main')).toEqual({ host: 'main', source: 'environment' })
  })

  it('rejects invalid nonempty values before the app can start child processes', () => {
    expect(() => selectDatabaseHost('sidecar')).toThrow(
      'Invalid MAILROVERS_DATABASE_HOST value "sidecar"; expected worker or main. Unset the variable to use worker.',
    )
  })

  it.each([' ', ' worker', 'worker ', 'Worker', 'WORKER', 'Main', 'MAIN'])(
    'rejects non-exact value %j',
    (value) => {
      expect(() => selectDatabaseHost(value)).toThrow(
        /Invalid MAILROVERS_DATABASE_HOST value.*expected worker or main.*Unset the variable to use worker/,
      )
    },
  )
})
