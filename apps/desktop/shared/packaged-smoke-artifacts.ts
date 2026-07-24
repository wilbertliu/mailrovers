import { z } from 'zod'

const checkpointSchema = z.object({
  stage: z.string().min(1),
  at: z.string().min(1),
})

const processGroupMarkerSchema = z.object({
  processGroupId: z.number().int().positive(),
  absentAfterTerminate: z.literal(true),
})

export type PackagedSmokeCheckpoint = z.infer<typeof checkpointSchema>
export type ProcessGroupMarker = z.infer<typeof processGroupMarkerSchema>

export function decodeCheckpointJsonLines(
  contents: string,
  source: string,
): PackagedSmokeCheckpoint[] {
  return contents
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((record) => record.line.length > 0)
    .map((record) => {
      try {
        return checkpointSchema.parse(JSON.parse(record.line))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Invalid checkpoint record in ${source} at line ${record.lineNumber}: ${detail}`,
          { cause: error },
        )
      }
    })
}

export function decodeProcessGroupMarker(input: unknown, source: string): ProcessGroupMarker {
  const result = processGroupMarkerSchema.safeParse(input)
  if (result.success) return result.data
  throw new Error(`Invalid process-group marker in ${source}: ${result.error.message}`, {
    cause: result.error,
  })
}
