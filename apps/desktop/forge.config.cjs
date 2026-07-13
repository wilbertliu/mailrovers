const { rebuild } = require('@electron/rebuild')
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives')
const { VitePlugin } = require('@electron-forge/plugin-vite')
const { cpSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const runtimeNativeModules = ['better-sqlite3', 'bindings', 'file-uri-to-path']

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
const config = {
  packagerConfig: {
    asar: { unpack: '**/*.node' },
    prune: false,
    afterCopy: [
      (buildPath, electronVersion, _platform, arch, callback) => {
        try {
          const sourceNodeModules = path.resolve(process.cwd(), '../../node_modules')
          const targetNodeModules = path.join(buildPath, 'node_modules')
          mkdirSync(targetNodeModules, { recursive: true })
          for (const moduleName of runtimeNativeModules) {
            cpSync(
              path.join(sourceNodeModules, moduleName),
              path.join(targetNodeModules, moduleName),
              { recursive: true, dereference: true },
            )
          }
          void rebuild({
            buildPath,
            electronVersion,
            arch,
            force: true,
            onlyModules: ['better-sqlite3'],
          }).then(
            () => callback(),
            (error) => callback(error instanceof Error ? error : new Error(String(error))),
          )
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)))
        }
      },
    ],
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'electron/main.ts', config: 'vite.main.config.ts' },
        { entry: 'electron/preload.ts', config: 'vite.preload.config.ts' },
        { entry: 'electron/database/database.worker.ts', config: 'vite.main.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
}

module.exports = config
