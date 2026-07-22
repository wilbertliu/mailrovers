import type { AttachmentStorage } from '@mailrovers/mail-application'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import path from 'node:path'
import { dialog } from 'electron'

const DEFAULT_CACHE_BYTES = 1024 * 1024 * 1024

function safeSuggestedName(value: string): string {
  const name = path
    .basename(value)
    .replaceAll(/\p{Cc}/gu, '')
    .trim()
  return name.length === 0 ? 'attachment' : name.slice(0, 255)
}

export class ElectronAttachmentStorage implements AttachmentStorage {
  private readonly attachmentsRoot: string

  constructor(
    private readonly input: {
      applicationDataRoot: string
      maximumCacheBytes?: number | undefined
      selectDestination?: ((suggestedName: string) => Promise<string | undefined>) | undefined
    },
  ) {
    this.attachmentsRoot = path.join(input.applicationDataRoot, 'attachments')
  }

  private resolve(relativePath: string): string {
    if (!/^attachments\/[0-9a-f-]+$/i.test(relativePath))
      throw new Error('Invalid generated attachment cache path')
    const resolved = path.resolve(this.input.applicationDataRoot, relativePath)
    if (!resolved.startsWith(`${path.resolve(this.attachmentsRoot)}${path.sep}`))
      throw new Error('Attachment cache path escaped its root')
    return resolved
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const file = this.resolve(relativePath)
      const value = await stat(file)
      if (!value.isFile()) return false
      const now = new Date()
      await utimes(file, now, now)
      return true
    } catch {
      return false
    }
  }

  async remove(relativePaths: readonly string[]): Promise<void> {
    await Promise.all(
      relativePaths.map(async (relativePath) => rm(this.resolve(relativePath), { force: true })),
    )
  }

  async cache(input: {
    stream: ReadableStream<Uint8Array>
    expectedSizeBytes: number
    signal: AbortSignal
  }): Promise<{ relativePath: string; sizeBytes: number }> {
    await mkdir(this.attachmentsRoot, { recursive: true })
    const name = randomUUID()
    const relativePath = `attachments/${name}`
    const destination = this.resolve(relativePath)
    const temporary = path.join(this.attachmentsRoot, `.${name}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    let sizeBytes = 0
    try {
      const reader = input.stream.getReader()
      while (true) {
        input.signal.throwIfAborted()
        const item = await reader.read()
        if (item.done) break
        sizeBytes += item.value.byteLength
        if (sizeBytes > input.expectedSizeBytes) {
          await reader.cancel()
          throw new Error('Attachment exceeded its declared size')
        }
        let offset = 0
        while (offset < item.value.byteLength) {
          const written = await handle.write(
            item.value,
            offset,
            item.value.byteLength - offset,
            null,
          )
          offset += written.bytesWritten
        }
      }
      if (sizeBytes !== input.expectedSizeBytes)
        throw new Error('Attachment did not match its declared size')
      await handle.sync()
      await handle.close()
      await rename(temporary, destination)
      await this.enforceLimit(destination)
      return { relativePath, sizeBytes }
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async export(input: {
    relativePath: string
    suggestedName: string
    signal: AbortSignal
  }): Promise<'exported' | 'cancelled'> {
    input.signal.throwIfAborted()
    const source = this.resolve(input.relativePath)
    const suggestedName = safeSuggestedName(input.suggestedName)
    const destination = this.input.selectDestination
      ? await this.input.selectDestination(suggestedName)
      : (
          await dialog.showSaveDialog({
            title: 'Export attachment',
            defaultPath: suggestedName,
          })
        ).filePath
    if (destination === undefined) return 'cancelled'
    input.signal.throwIfAborted()
    const temporary = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.mailrovers-${randomUUID()}.tmp`,
    )
    try {
      await copyFile(source, temporary)
      input.signal.throwIfAborted()
      await rename(temporary, destination)
      return 'exported'
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async enforceLimit(currentPath: string): Promise<void> {
    const maximum = this.input.maximumCacheBytes ?? DEFAULT_CACHE_BYTES
    const entries = await readdir(this.attachmentsRoot, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^[0-9a-f-]+$/i.test(entry.name))
        .map(async (entry) => {
          const filePath = path.join(this.attachmentsRoot, entry.name)
          const value = await stat(filePath)
          return { filePath, size: value.size, usedAt: value.mtimeMs }
        }),
    )
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((left, right) => left.usedAt - right.usedAt)) {
      if (total <= maximum) break
      if (file.filePath === currentPath) continue
      await rm(file.filePath, { force: true })
      total -= file.size
    }
  }
}
