import { writeFileSync } from 'node:fs'
import { redactedJson } from '@mailrovers/platform-electron'

/** Writes bounded, redacted cleanup diagnostics while retaining structural metadata. */
export function writeCleanupFailureDiagnostic(filePath: string, diagnostic: unknown): void {
  writeFileSync(filePath, `${redactedJson(diagnostic, 2)}\n`)
}
