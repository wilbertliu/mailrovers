import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { allowDevelopmentStyles } from './src/development-csp.js'
import { rendererAliases } from './vite.shared.config.js'

const rendererDir = path.dirname(fileURLToPath(import.meta.url))
const bootLogoSrc = `data:image/png;base64,${readFileSync(path.join(rendererDir, 'src/assets/logo.png')).toString('base64')}`

function developmentCspPlugin(): Plugin {
  return {
    name: 'mailrovers-development-csp',
    apply: 'serve',
    transformIndexHtml: allowDevelopmentStyles,
  }
}

function bootLogoPlugin(): Plugin {
  return {
    name: 'mailrovers-boot-logo',
    transformIndexHtml(html) {
      return html.replaceAll('__MAILROVERS_BOOT_LOGO_SRC__', bootLogoSrc)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), bootLogoPlugin(), developmentCspPlugin()],
  base: './',
  resolve: {
    alias: rendererAliases,
  },
})
