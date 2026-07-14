import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as publicApi from '../src/index.js'
import { describe, expect, it } from 'vitest'

const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url))

function implementationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? implementationFiles(`${directory}/${entry.name}`)
      : entry.name.endsWith('.ts')
        ? [`${directory}/${entry.name}`]
        : [],
  )
}

describe('SQLite store module boundaries', () => {
  it('keeps every implementation module below the physical line limit', () => {
    const oversized = implementationFiles(sourceDirectory)
      .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n').length - 1 }))
      .filter(({ lines }) => lines >= 1000)
    expect(oversized).toEqual([])
  })

  it('exports only the established public SQLite store surface', () => {
    expect(Object.keys(publicApi).sort()).toEqual(['SqliteMailStore', 'migrate', 'openDatabase'])
  })
})
