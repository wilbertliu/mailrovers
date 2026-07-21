import { describe, expect, it } from 'vitest'
import { packagedAppEnvironment } from '../perf/packaged-app-environment.js'

describe('packagedAppEnvironment', () => {
  it('does not pass Electron Node-mode through to the packaged app', () => {
    const environment = packagedAppEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      MAILROVERS_DB_PATH: '/tmp/mailrovers.sqlite',
    })

    expect(environment).toEqual({ MAILROVERS_DB_PATH: '/tmp/mailrovers.sqlite' })
  })
})
