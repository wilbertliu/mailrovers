import { rebuild } from '@electron/rebuild';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const runtimeNativeModules = ['better-sqlite3', 'bindings', 'file-uri-to-path'] as const;

const config = {
  packagerConfig: {
    asar: { unpack: '**/*.node' },
    prune: false,
    afterCopy: [(buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (error?: Error) => void) => {
      try {
        const sourceNodeModules = path.resolve(process.cwd(), '../../node_modules');
        const targetNodeModules = path.join(buildPath, 'node_modules');
        mkdirSync(targetNodeModules, { recursive: true });
        for (const moduleName of runtimeNativeModules) {
          cpSync(path.join(sourceNodeModules, moduleName), path.join(targetNodeModules, moduleName), { recursive: true, dereference: true });
        }
        void rebuild({ buildPath, electronVersion: _electronVersion, arch: _arch, force: true, onlyModules: ['better-sqlite3'] }).then(
          () => callback(),
          (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
        );
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    }],
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
};

export default config;
