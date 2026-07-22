import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStartupScreenDocument } from '../src/startup-screen-document.js'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const sharedCss = readFileSync(path.join(desktopRoot, 'startup-splash-shared.css'), 'utf8')

describe('startup splash shared CSS', () => {
  it('is inlined into the Electron startup document', () => {
    const document = createStartupScreenDocument('data:image/png;base64,AA==')
    expect(document).toContain('startup-splash-logo')
    expect(document).toContain('startup-splash-surface')
    expect(document).toContain('startup-splash-shine')
    expect(document).toContain('mix-blend-mode: soft-light')
    expect(document).toContain(sharedCss.trim())
    expect(document).not.toContain('logo-shine')
  })

  it('is imported by the React boot-splash stylesheet', () => {
    const bootSplash = readFileSync(path.join(desktopRoot, 'boot-splash.css'), 'utf8')
    expect(bootSplash).toContain("@import './startup-splash-shared.css'")
    expect(bootSplash).not.toContain('@keyframes startup-splash-shine')
    expect(bootSplash).not.toContain('Keep in sync')
  })
})
