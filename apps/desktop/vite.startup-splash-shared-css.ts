import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Virtual module id for inlining `startup-splash-shared.css` into Electron/Storybook HTML. */
export const STARTUP_SPLASH_SHARED_CSS_ID = 'mailrovers:startup-splash-shared-css'

const cssPath = fileURLToPath(new URL('./startup-splash-shared.css', import.meta.url))

/** Expose shared splash CSS as a string for `createStartupScreenDocument`. */
export function startupSplashSharedCssPlugin(): Plugin {
  const resolvedId = `\0${STARTUP_SPLASH_SHARED_CSS_ID}`
  return {
    name: 'mailrovers-startup-splash-shared-css',
    resolveId(id) {
      if (id === STARTUP_SPLASH_SHARED_CSS_ID) return resolvedId
    },
    load(id) {
      if (id !== resolvedId) return
      return `export default ${JSON.stringify(readFileSync(cssPath, 'utf8'))}`
    },
  }
}
