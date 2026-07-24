import { z } from 'zod'

const finiteNumber = z.number().finite()
const nonNegativeNumber = finiteNumber.nonnegative()
const timestamp = z.string().min(1)

export const packagedSmokeModeSchema = z.enum(['main', 'worker'])
export const packagedPerformanceScenarioSchema = z.enum(['complete-index', 'pending-fts-backfill'])

const processMetricSchema = z.object({
  pid: z.number().int().nonnegative(),
  type: z.string(),
  workingSetKb: nonNegativeNumber,
})

export const packagedPerformanceSchema = z.discriminatedUnion('capturedAt', [
  z.object({
    capturedAt: z.literal('afterIdle'),
    idleDelayMs: nonNegativeNumber,
    workingSetMb: nonNegativeNumber,
    peakDuringIndexingMb: nonNegativeNumber.optional(),
    workingSetAtIndexingEndMb: nonNegativeNumber.optional(),
    processes: z.array(processMetricSchema),
  }),
  z.object({
    capturedAt: z.literal('indexingComplete'),
    idleDelayMs: nonNegativeNumber,
    workingSetMb: nonNegativeNumber,
    peakDuringIndexingMb: nonNegativeNumber,
    workingSetAtIndexingEndMb: nonNegativeNumber,
    processes: z.array(processMetricSchema),
  }),
])

export const packagedRendererProbeSchema = z.object({
  rows: z.number().int().nonnegative(),
  processType: z.string(),
  requireType: z.string(),
  bridgeKeys: z.array(z.string()),
  scroll: z
    .object({
      durationMs: nonNegativeNumber,
      frameCount: z.number().int().nonnegative(),
      fps: nonNegativeNumber,
      p95FrameMs: nonNegativeNumber,
      maxFrameMs: nonNegativeNumber,
      framesOver20Ms: z.number().int().nonnegative(),
    })
    .optional(),
})

const packagedSmokeSuccessSchema = z.object({
  status: z.literal('passed'),
  startedAt: timestamp.optional(),
  completedAt: timestamp.optional(),
  databaseHost: packagedSmokeModeSchema,
  databaseHostSource: z.enum(['default', 'environment']),
  performanceScenario: packagedPerformanceScenarioSchema,
  stages: z.record(finiteNumber),
  mainEventLoopStallMs: nonNegativeNumber,
  searchBackfillMs: nonNegativeNumber.optional(),
  duringIndexingQuery: z
    .object({
      latencyMs: nonNegativeNumber,
      overlapped: z.boolean(),
      rows: z.number().int().nonnegative(),
      rowsOk: z.boolean(),
      valid: z.boolean(),
      request: z.object({
        startWall: finiteNumber,
        endWall: finiteNumber,
      }),
      batch: z.object({
        id: z.number().int().nonnegative(),
        startWall: finiteNumber,
        endWall: finiteNumber,
        durationMs: nonNegativeNumber,
      }),
    })
    .optional(),
  searchIndexing: z
    .object({
      peakDuringIndexingMb: nonNegativeNumber,
      workingSetAtIndexingEndMb: nonNegativeNumber,
      batchCount: z.number().int().nonnegative(),
      maxBatchDurationMs: nonNegativeNumber,
    })
    .optional(),
  rendererProbe: packagedRendererProbeSchema,
  safeStorageProbe: z.object({
    roundTrip: z.boolean(),
    ciphertextContainsPlaintext: z.boolean(),
  }),
  packagedPerformance: packagedPerformanceSchema.optional(),
})

const packagedSmokeFailureSchema = z.object({
  status: z.literal('failed'),
  databaseHost: packagedSmokeModeSchema,
  databaseHostSource: z.enum(['default', 'environment']),
  error: z.unknown(),
  stages: z.record(finiteNumber),
})

export const packagedSmokeResultSchema = z.discriminatedUnion('status', [
  packagedSmokeSuccessSchema,
  packagedSmokeFailureSchema,
])

const completedPackagedSmokeSuccessSchema = packagedSmokeSuccessSchema.extend({
  startedAt: timestamp,
  completedAt: timestamp,
})

const packagedSmokeHarnessReportFields = {
  startedAt: timestamp,
  completedAt: timestamp,
  invocationId: z.string().min(1).optional(),
  directory: z.string().min(1),
  scenario: packagedPerformanceScenarioSchema,
  idleDelayMs: nonNegativeNumber,
  performanceRequested: z.boolean(),
  performanceFailures: z.array(z.string()),
  results: z.array(
    z.object({
      mode: packagedSmokeModeSchema,
      result: completedPackagedSmokeSuccessSchema,
    }),
  ),
}

export const packagedSmokeHarnessReportSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('passed'),
    ...packagedSmokeHarnessReportFields,
  }),
  z.object({
    status: z.literal('failed'),
    ...packagedSmokeHarnessReportFields,
  }),
])

const packagedSmokeReportDirectorySchema = z.object({
  directory: z.string().min(1),
})

export type PackagedSmokeMode = z.infer<typeof packagedSmokeModeSchema>
export type PackagedPerformanceScenario = z.infer<typeof packagedPerformanceScenarioSchema>
export type PackagedPerformance = z.infer<typeof packagedPerformanceSchema>
export type PackagedRendererProbe = z.infer<typeof packagedRendererProbeSchema>
export type PackagedSmokeSuccess = z.infer<typeof packagedSmokeSuccessSchema>
export type CompletedPackagedSmokeSuccess = z.infer<typeof completedPackagedSmokeSuccessSchema>
export type PackagedSmokeResult = z.infer<typeof packagedSmokeResultSchema>
export type PackagedSmokeHarnessReport = z.infer<typeof packagedSmokeHarnessReportSchema>

export function decodePackagedRendererProbe(input: unknown): PackagedRendererProbe {
  return packagedRendererProbeSchema.parse(input)
}

export function decodePackagedSmokeResult(input: unknown): PackagedSmokeResult {
  return packagedSmokeResultSchema.parse(input)
}

export function decodePackagedSmokeHarnessReport(input: unknown): PackagedSmokeHarnessReport {
  return packagedSmokeHarnessReportSchema.parse(input)
}

export function decodePackagedSmokeReportDirectory(input: unknown): string {
  return packagedSmokeReportDirectorySchema.parse(input).directory
}
