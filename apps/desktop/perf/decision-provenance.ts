import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { extractFile as extractAsarFile } from '@electron/asar'

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.html',
  '.sh',
  '.sql',
])

const SOURCE_ROOTS = ['apps/desktop', 'packages', 'docs', 'scripts'] as const
const ROOT_SOURCE_FILES = ['package.json', 'pnpm-lock.yaml', 'tsconfig.base.json'] as const
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  'artifacts',
  'out',
  '.vite',
  'dist',
  'coverage',
  '.git',
  'storybook-static',
])

export type ProvenanceFileEntry = {
  path: string
  sha256: string
  bytes: number
}

export type PackagedProvenance = {
  packageTimestamp: string
  electronVersion: string
  platform: NodeJS.Platform
  arch: string
  macosProductVersion?: string
  macosBuildVersion?: string
  appBundle: string
  appAsarSha256: string
  databaseWorkerSha256: string
  executableSha256: string
  infoPlistSha256: string
}

export type SourceProvenance = {
  gitHead: string
  gitStatusSha256: string
  stagedDiffSha256: string
  unstagedDiffSha256: string
  trackedDiffSha256: string
  untrackedSourceFiles: ProvenanceFileEntry[]
  untrackedSourceArchiveSha256: string
  untrackedSourceTreeSha256: string
  sourceManifestSha256: string
}

function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function sha256File(filePath: string): string {
  const previousNoAsar = process.noAsar
  process.noAsar = true
  try {
    return sha256Buffer(readFileSync(filePath))
  } finally {
    process.noAsar = previousNoAsar
  }
}

function shouldIncludeSourceFile(relativePath: string): boolean {
  const extension = path.extname(relativePath)
  const segments = relativePath.split(/[\\/]/)
  return (
    SOURCE_EXTENSIONS.has(extension) && !segments.some((segment) => EXCLUDED_DIR_NAMES.has(segment))
  )
}

function walkSourceFiles(repoRoot: string, relativeRoot: string, out: string[]): void {
  const absolute = path.join(repoRoot, relativeRoot)
  if (!existsSync(absolute)) return
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIR_NAMES.has(entry.name)) walkSourceFiles(repoRoot, relativePath, out)
      continue
    }
    if (entry.isFile() && shouldIncludeSourceFile(relativePath)) out.push(relativePath)
  }
}

function gitText(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

function listUntrackedSourceFiles(repoRoot: string): string[] {
  const porcelain = gitText(repoRoot, ['status', '--porcelain=v1', '-uall'])
  return porcelain
    .split('\n')
    .flatMap((line) => (line.startsWith('?? ') ? [line.slice(3).trim()] : []))
    .filter(
      (relativePath) =>
        relativePath.length > 0 &&
        SOURCE_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`)) &&
        shouldIncludeSourceFile(relativePath),
    )
    .sort()
}

function listSourceManifestFiles(repoRoot: string): ProvenanceFileEntry[] {
  const paths: string[] = []
  for (const root of SOURCE_ROOTS) walkSourceFiles(repoRoot, root, paths)
  for (const rootFile of ROOT_SOURCE_FILES)
    if (existsSync(path.join(repoRoot, rootFile))) paths.push(rootFile)
  return [...new Set(paths)].sort().map((relativePath) => {
    const absolute = path.join(repoRoot, relativePath)
    return { path: relativePath, sha256: sha256File(absolute), bytes: statSync(absolute).size }
  })
}

function writeArchiveFile(
  archiveRoot: string,
  relativePath: string,
  contents: string | Buffer,
): string {
  const target = path.join(archiveRoot, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

function archiveSourceEvidence(input: { repoRoot: string; archiveRoot: string }): SourceProvenance {
  const gitHead = gitText(input.repoRoot, ['rev-parse', 'HEAD']).trim()
  const gitStatus = gitText(input.repoRoot, ['status', '--porcelain=v1', '-uall'])
  const stagedDiff = gitText(input.repoRoot, ['diff', '--cached', '--no-ext-diff'])
  const unstagedDiff = gitText(input.repoRoot, ['diff', '--no-ext-diff'])
  const trackedDiff = gitText(input.repoRoot, ['diff', 'HEAD', '--no-ext-diff'])
  const untrackedPaths = listUntrackedSourceFiles(input.repoRoot)
  const untrackedSourceFiles = untrackedPaths.map((relativePath) => {
    const absolute = path.join(input.repoRoot, relativePath)
    return { path: relativePath, sha256: sha256File(absolute), bytes: statSync(absolute).size }
  })
  const untrackedSourceArchive = untrackedSourceFiles.map((entry) => ({
    ...entry,
    contentsBase64: readFileSync(path.join(input.repoRoot, entry.path)).toString('base64'),
  }))
  const sourceManifestFiles = listSourceManifestFiles(input.repoRoot)
  const stagedDiffSha256 = sha256Buffer(Buffer.from(stagedDiff, 'utf8'))
  const unstagedDiffSha256 = sha256Buffer(Buffer.from(unstagedDiff, 'utf8'))
  const trackedDiffSha256 = sha256Buffer(Buffer.from(trackedDiff, 'utf8'))
  const untrackedSourceTreeSha256 = sha256Buffer(
    Buffer.from(JSON.stringify(untrackedSourceFiles), 'utf8'),
  )
  const sourceManifestSha256 = sha256Buffer(
    Buffer.from(JSON.stringify(sourceManifestFiles), 'utf8'),
  )
  const untrackedSourceArchiveBytes = Buffer.from(
    `${JSON.stringify(untrackedSourceArchive, null, 2)}\n`,
    'utf8',
  )
  const untrackedSourceArchiveSha256 = sha256Buffer(untrackedSourceArchiveBytes)

  writeArchiveFile(input.archiveRoot, 'HEAD', `${gitHead}\n`)
  writeArchiveFile(input.archiveRoot, 'git-status.txt', gitStatus)
  writeArchiveFile(input.archiveRoot, 'staged.patch', stagedDiff)
  writeArchiveFile(input.archiveRoot, 'unstaged.patch', unstagedDiff)
  writeArchiveFile(input.archiveRoot, 'tracked.patch', trackedDiff)
  writeArchiveFile(
    input.archiveRoot,
    'untracked-manifest.json',
    `${JSON.stringify(untrackedSourceFiles, null, 2)}\n`,
  )
  writeArchiveFile(input.archiveRoot, 'untracked-source-contents.json', untrackedSourceArchiveBytes)
  writeArchiveFile(
    input.archiveRoot,
    'source-manifest.json',
    `${JSON.stringify(sourceManifestFiles, null, 2)}\n`,
  )

  return {
    gitHead,
    gitStatusSha256: sha256Buffer(Buffer.from(gitStatus, 'utf8')),
    stagedDiffSha256,
    unstagedDiffSha256,
    trackedDiffSha256,
    untrackedSourceFiles,
    untrackedSourceArchiveSha256,
    untrackedSourceTreeSha256,
    sourceManifestSha256,
  }
}

export function buildPackagedProvenance(input: {
  repoRoot: string
  appBundle: string
}): PackagedProvenance {
  const executable = path.join(input.appBundle, 'Contents', 'MacOS', 'MailRovers')
  const infoPlist = path.join(input.appBundle, 'Contents', 'Info.plist')
  const appAsar = path.join(input.appBundle, 'Contents', 'Resources', 'app.asar')
  const packagedWorkerUnpacked = path.join(
    input.appBundle,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    '.vite',
    'build',
    'database.worker.js',
  )
  if (!existsSync(executable)) throw new Error(`Missing packaged executable: ${executable}`)
  if (!existsSync(appAsar)) throw new Error(`Missing app.asar: ${appAsar}`)

  const databaseWorkerSha256 = existsSync(packagedWorkerUnpacked)
    ? sha256File(packagedWorkerUnpacked)
    : sha256Buffer(Buffer.from(extractAsarFile(appAsar, '.vite/build/database.worker.js')))
  const electronPackageJson = path.join(input.repoRoot, 'node_modules/electron/package.json')
  if (!existsSync(electronPackageJson))
    throw new Error(`Missing Electron package.json at ${electronPackageJson}`)
  const electronPackage = JSON.parse(readFileSync(electronPackageJson, 'utf8')) as {
    version?: string
  }
  if (!electronPackage.version) throw new Error('electron/package.json missing version')

  const packaged: PackagedProvenance = {
    packageTimestamp: statSync(appAsar).mtime.toISOString(),
    electronVersion: `v${electronPackage.version}`,
    platform: process.platform,
    arch: process.arch,
    appBundle: input.appBundle,
    appAsarSha256: sha256File(appAsar),
    databaseWorkerSha256,
    executableSha256: sha256File(executable),
    infoPlistSha256: sha256File(infoPlist),
  }
  if (process.platform === 'darwin') {
    packaged.macosProductVersion = execFileSync('sw_vers', ['-productVersion'], {
      encoding: 'utf8',
    }).trim()
    packaged.macosBuildVersion = execFileSync('sw_vers', ['-buildVersion'], {
      encoding: 'utf8',
    }).trim()
  }
  return packaged
}

export function writeDecisionProvenance(input: {
  repoRoot: string
  appBundle: string
  outputPath: string
  archiveRoot: string
}): {
  source: SourceProvenance
  packaged: PackagedProvenance
  provenanceSha256: string
} {
  if (existsSync(input.outputPath))
    throw new Error(`Provenance already exists: ${input.outputPath}`)
  mkdirSync(input.archiveRoot, { recursive: true })
  const source = archiveSourceEvidence({ repoRoot: input.repoRoot, archiveRoot: input.archiveRoot })
  const packaged = buildPackagedProvenance(input)
  const document = { source, packaged }
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
  const provenanceSha256 = sha256Buffer(bytes)
  writeFileSync(input.outputPath, bytes, { flag: 'wx', mode: 0o444 })
  chmodSync(input.outputPath, 0o444)
  return { source, packaged, provenanceSha256 }
}

export function sha256FileBytes(filePath: string): string {
  return sha256File(filePath)
}
