'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const APP_NAME = 'MailRovers'
const BUNDLE_ID = 'app.mailrovers.desktop.dev'

function electronPackageRoot() {
  return path.dirname(require.resolve('electron/package.json'))
}

function electronDistRoot() {
  return path.join(electronPackageRoot(), 'dist')
}

function replacePlistString(plistPath, key, value) {
  execFileSync('plutil', ['-replace', key, '-string', value, plistPath], { stdio: 'pipe' })
}

function renameIfNeeded(fromPath, toPath) {
  if (!fs.existsSync(fromPath)) return
  if (fs.existsSync(toPath)) {
    fs.rmSync(toPath, { recursive: true, force: true })
  }
  fs.renameSync(fromPath, toPath)
}

function ensureExecutableName(appBundle) {
  const macOsDir = path.join(appBundle, 'Contents', 'MacOS')
  const currentBinary = path.join(macOsDir, 'Electron')
  const targetBinary = path.join(macOsDir, APP_NAME)
  if (fs.existsSync(currentBinary)) {
    renameIfNeeded(currentBinary, targetBinary)
  }
  if (!fs.existsSync(targetBinary)) {
    throw new Error(`MailRovers executable missing at ${targetBinary}`)
  }
}

function ensureAppIcon(appBundle) {
  const sourceIcon = path.resolve(__dirname, '..', 'resources', 'icon.icns')
  const targetIcon = path.join(appBundle, 'Contents', 'Resources', 'electron.icns')
  if (!fs.existsSync(sourceIcon)) {
    throw new Error(`App icon missing at ${sourceIcon}`)
  }
  fs.copyFileSync(sourceIcon, targetIcon)
}

function writePathTxt(appBundle) {
  const relativeBinary = path.join(path.basename(appBundle), 'Contents', 'MacOS', APP_NAME)
  fs.writeFileSync(path.join(electronPackageRoot(), 'path.txt'), relativeBinary)
}

function refreshLaunchServices(appBundle) {
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  if (!fs.existsSync(lsregister)) return
  try {
    execFileSync(lsregister, ['-f', appBundle], { stdio: 'pipe' })
  } catch {
    // Best-effort: Cmd+Tab still picks up the renamed bundle on next launch.
  }
}

function resolveAppBundle(distRoot) {
  const electronApp = path.join(distRoot, 'Electron.app')
  const mailroversApp = path.join(distRoot, `${APP_NAME}.app`)

  if (fs.existsSync(electronApp)) {
    renameIfNeeded(electronApp, mailroversApp)
  }

  if (!fs.existsSync(mailroversApp)) {
    throw new Error(`Neither Electron.app nor ${APP_NAME}.app found in ${distRoot}`)
  }

  return mailroversApp
}

function main() {
  if (process.platform !== 'darwin') return

  const distRoot = electronDistRoot()
  const appBundle = resolveAppBundle(distRoot)
  const plistPath = path.join(appBundle, 'Contents', 'Info.plist')
  if (!fs.existsSync(plistPath)) {
    throw new Error(`Info.plist not found at ${plistPath}`)
  }

  ensureExecutableName(appBundle)
  ensureAppIcon(appBundle)

  replacePlistString(plistPath, 'CFBundleName', APP_NAME)
  replacePlistString(plistPath, 'CFBundleDisplayName', APP_NAME)
  replacePlistString(plistPath, 'CFBundleExecutable', APP_NAME)
  replacePlistString(plistPath, 'CFBundleIdentifier', BUNDLE_ID)

  writePathTxt(appBundle)
  refreshLaunchServices(appBundle)
}

main()
