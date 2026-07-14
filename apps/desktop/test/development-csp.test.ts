import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allowDevelopmentStyles } from '../src/development-csp.js'

const indexHtmlPath = fileURLToPath(new URL('../index.html', import.meta.url))
const indexHtml = readFileSync(indexHtmlPath, 'utf8')

describe('renderer content security policy', () => {
  it('keeps the packaged HTML style policy strict', () => {
    expect(indexHtml).toContain("style-src 'self'")
    expect(indexHtml).not.toContain("style-src 'self' 'unsafe-inline'")
  })

  it('allows Vite to inject styles during development', () => {
    expect(allowDevelopmentStyles(indexHtml)).toContain("style-src 'self' 'unsafe-inline'")
  })
})
