import { fileURLToPath } from 'node:url'

export const rendererAliases = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}
