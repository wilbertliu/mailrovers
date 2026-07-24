import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { setTimeout as delay } from 'node:timers/promises'
import { utcTimestamp } from '@mailrovers/mail-domain'
import { redactedJson } from '@mailrovers/platform-electron'
import { percentile } from './budgets.js'
import { decodeDatabaseInput, parseDatabaseRequest } from '../electron/database/database-rpc.js'
import { createWorkerDatabaseHost } from '../electron/database/worker-database-host.js'
import {
  buildApplyImportBatchCloneProbeInput,
  buildProbeCheckpoint,
  buildProbeMailbox,
  estimateStructuredCloneEnvelopeBytes,
  summarizeWorkerRpcCloneProbePayload,
  WORKER_RPC_CLONE_PRODUCTION_BATCH,
  WORKER_RPC_CLONE_PROBE_OWNER,
  WORKER_RPC_CLONE_PROBE_TIMESTAMP,
  WORKER_RPC_CLONE_STRESS_BATCH,
} from './worker-rpc-clone-payload.js'

export type WorkerRpcCloneProbeSample = {
  validateDecodeMs: number
  structuredCloneMs: number
  workerHostRoundTripMs: number
  mainEventLoopStallMs: number
}

export type WorkerRpcCloneBatchLabel = 'production-25' | 'stress-250'

export type WorkerRpcCloneBatchReport = {
  label: WorkerRpcCloneBatchLabel
  messageCount: number
  rationale: string
  payload: ReturnType<typeof summarizeWorkerRpcCloneProbePayload>
  envelopeJsonBytes: number
  warmups: number
  measuredRepetitions: number
  samples: WorkerRpcCloneProbeSample[]
  summary: {
    validateDecodeMs: { median: number; p95: number; max: number }
    structuredCloneMs: { median: number; p95: number; max: number }
    workerHostRoundTripMs: { median: number; p95: number; max: number }
    mainEventLoopStallMs: { median: number; p95: number; max: number }
  }
}

export type WorkerRpcCloneProbeReport = {
  scenario: 'worker-rpc-clone-applyImportBatch'
  environment: {
    capturedAt: string
    platform: NodeJS.Platform
    arch: string
    node: string
    databaseWorkerPath: string
    databaseWorkerSha256: string
  }
  batches: WorkerRpcCloneBatchReport[]
  interpretation: {
    measures: string[]
    doesNotMeasure: string[]
  }
}

function resolveDatabaseWorkerPath(): string {
  const candidates = [
    path.join(process.cwd(), '.vite/build/database.worker.js'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../.vite/build/database.worker.js'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  throw new Error(
    'database.worker.js not found; run pnpm --filter @mailrovers/desktop package:mac (or forge package) first',
  )
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function summarizeSamples(samples: WorkerRpcCloneProbeSample[]) {
  const pick = (select: (sample: WorkerRpcCloneProbeSample) => number) => {
    const values = samples.map(select)
    return {
      median: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: Math.max(...values),
    }
  }
  return {
    validateDecodeMs: pick((sample) => sample.validateDecodeMs),
    structuredCloneMs: pick((sample) => sample.structuredCloneMs),
    workerHostRoundTripMs: pick((sample) => sample.workerHostRoundTripMs),
    mainEventLoopStallMs: pick((sample) => sample.mainEventLoopStallMs),
  }
}

function measureEventLoopStallDuring(
  work: () => void | Promise<void>,
  sampleIntervalMs = 1,
): Promise<{ stallMs: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    let maxGap = 0
    let last = performance.now()
    const started = last
    const timer = setInterval(() => {
      const now = performance.now()
      maxGap = Math.max(maxGap, now - last - sampleIntervalMs)
      last = now
    }, sampleIntervalMs)
    timer.unref?.()

    Promise.resolve()
      .then(work)
      .then(() => {
        clearInterval(timer)
        const ended = performance.now()
        maxGap = Math.max(maxGap, ended - last - sampleIntervalMs)
        resolve({ stallMs: Math.max(0, maxGap), durationMs: ended - started })
      })
      .catch((error) => {
        clearInterval(timer)
        reject(error)
      })
  })
}

type ProbeHost = Awaited<ReturnType<typeof createWorkerDatabaseHost>>

async function measureBatch(input: {
  host: ProbeHost
  label: WorkerRpcCloneBatchLabel
  messageCount: number
  rationale: string
  fence: { ownerId: string; fencingToken: number; now: typeof WORKER_RPC_CLONE_PROBE_TIMESTAMP }
  startIndex: number
  warmups: number
  repetitions: number
}): Promise<{ report: WorkerRpcCloneBatchReport; nextStartIndex: number }> {
  const samples: WorkerRpcCloneProbeSample[] = []
  let startIndex = input.startIndex
  const total = input.warmups + input.repetitions

  for (let i = 0; i < total; i += 1) {
    const probeInput = buildApplyImportBatchCloneProbeInput({
      messageCount: input.messageCount,
      startIndex,
      fence: input.fence,
    })
    const validateStarted = performance.now()
    const decoded = decodeDatabaseInput('applyImportBatch', probeInput)
    const validateDecodeMs = performance.now() - validateStarted

    const envelope = { id: 1, method: 'applyImportBatch' as const, input: decoded }
    const cloneStarted = performance.now()
    const cloned = structuredClone(envelope)
    const structuredCloneMs = performance.now() - cloneStarted
    parseDatabaseRequest(cloned)

    const { stallMs, durationMs } = await measureEventLoopStallDuring(async () => {
      await input.host.store.applyImportBatch(decoded)
    })

    if (i >= input.warmups)
      samples.push({
        validateDecodeMs,
        structuredCloneMs,
        workerHostRoundTripMs: durationMs,
        mainEventLoopStallMs: stallMs,
      })
    startIndex += input.messageCount
    await delay(10)
  }

  const envelopeForSize = {
    id: 1,
    method: 'applyImportBatch' as const,
    input: decodeDatabaseInput(
      'applyImportBatch',
      buildApplyImportBatchCloneProbeInput({ messageCount: input.messageCount }),
    ),
  }

  return {
    nextStartIndex: startIndex,
    report: {
      label: input.label,
      messageCount: input.messageCount,
      rationale: input.rationale,
      payload: summarizeWorkerRpcCloneProbePayload(input.messageCount),
      envelopeJsonBytes: estimateStructuredCloneEnvelopeBytes(envelopeForSize),
      warmups: input.warmups,
      measuredRepetitions: input.repetitions,
      samples,
      summary: summarizeSamples(samples),
    },
  }
}

export async function runWorkerRpcCloneProbe(options?: {
  warmups?: number
  repetitions?: number
  databaseWorkerPath?: string
}): Promise<WorkerRpcCloneProbeReport> {
  const warmups = options?.warmups ?? 2
  const repetitions = options?.repetitions ?? 5
  if (!Number.isInteger(warmups) || warmups < 0)
    throw new Error('warmups must be a non-negative integer')
  if (!Number.isInteger(repetitions) || repetitions < 1)
    throw new Error('repetitions must be a positive integer')

  const databaseWorkerPath = options?.databaseWorkerPath ?? resolveDatabaseWorkerPath()
  const databaseWorkerSha256 = sha256File(databaseWorkerPath)
  const tempDirectory = mkdtempSync(path.join(tmpdir(), 'mailrovers-worker-rpc-clone-'))
  const databasePath = path.join(tempDirectory, 'probe.sqlite')

  const host = await createWorkerDatabaseHost(
    databasePath,
    () => new Worker(databaseWorkerPath, { workerData: { dbPath: databasePath } }),
  )

  const batches: WorkerRpcCloneBatchReport[] = []
  try {
    await host.store.saveConnectedMailbox({
      mailbox: buildProbeMailbox(),
      checkpoint: buildProbeCheckpoint(),
      encryptedRefreshToken: new Uint8Array([1, 2, 3, 4]),
    })
    const lease = await host.store.acquireSyncLease({
      mailboxId: buildProbeMailbox().id,
      ownerId: WORKER_RPC_CLONE_PROBE_OWNER,
      now: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
      expiresAt: utcTimestamp('2100-01-01T00:00:00.000Z'),
    })
    if (lease === undefined) throw new Error('Failed to acquire probe sync lease')
    const fence = {
      ownerId: lease.ownerId,
      fencingToken: lease.fencingToken,
      now: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
    }

    let startIndex = 0
    const production = await measureBatch({
      host,
      label: 'production-25',
      messageCount: WORKER_RPC_CLONE_PRODUCTION_BATCH,
      rationale:
        'Gmail provider detailBatchSize default is 25 (packages/provider-gmail/src/provider.ts)',
      fence,
      startIndex,
      warmups,
      repetitions,
    })
    batches.push(production.report)
    startIndex = production.nextStartIndex

    const stress = await measureBatch({
      host,
      label: 'stress-250',
      messageCount: WORKER_RPC_CLONE_STRESS_BATCH,
      rationale: 'Conservative stress matching SEARCH_BACKFILL_BATCH_LIMIT / FTS batch cardinality',
      fence,
      startIndex,
      warmups,
      repetitions,
    })
    batches.push(stress.report)
  } finally {
    await host.close()
    rmSync(tempDirectory, { recursive: true, force: true })
  }

  return {
    scenario: 'worker-rpc-clone-applyImportBatch',
    environment: {
      capturedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      databaseWorkerPath,
      databaseWorkerSha256,
    },
    batches,
    interpretation: {
      measures: [
        'applyImportBatch input codec validation (decodeDatabaseInput)',
        'structuredClone of the worker postMessage request envelope',
        'createWorkerDatabaseHost + built database.worker.js applyImportBatch round-trip',
        'main-thread event-loop stall while posting/awaiting the worker RPC (interval monitor)',
        'production-shape 25-message and stress 250-message batches with MIME + attachment metadata',
        'median/p95/max after untimed warmups',
      ],
      doesNotMeasure: [
        'pending-fts-backfill SearchIndex batches (those RPC envelopes are tiny; bodies stay in-worker)',
        '60-second packaged idle RSS',
        'packaged Electron multi-process idle working set',
      ],
    },
  }
}

async function main(): Promise<void> {
  const report = await runWorkerRpcCloneProbe()
  const directory = path.join(
    process.cwd(),
    'artifacts',
    'worker-rpc-clone',
    report.environment.capturedAt.replace(/[:.]/g, '-'),
  )
  mkdirSync(directory, { recursive: true })
  const reportPath = path.join(directory, 'report.json')
  writeFileSync(reportPath, `${redactedJson(report, 2)}\n`)
  process.stdout.write(`${redactedJson({ directory: reportPath, ...report }, 2)}\n`)
}

const entryPath = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === entryPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
