import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.js'
import { subscribeDesktopChangeInvalidation } from './desktop-change-invalidation.js'
import { createDesktopQueryClient } from './query-client.js'
import './styles.css'

const systemTheme = matchMedia('(prefers-color-scheme: dark)')

function applySystemTheme() {
  const theme = systemTheme.matches ? 'dark' : 'light'
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
}

applySystemTheme()
systemTheme.addEventListener('change', applySystemTheme)

const client = createDesktopQueryClient()
subscribeDesktopChangeInvalidation({ queryClient: client })
performance.mark('rendererMounted')
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
)
