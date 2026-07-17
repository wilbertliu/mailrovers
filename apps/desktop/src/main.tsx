import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.js'
import { subscribeDesktopChangeInvalidation } from './desktop-change-invalidation.js'
import { createDesktopQueryClient } from './query-client.js'
import './styles.css'

function applyTheme() {
  const storedTheme = localStorage.getItem('theme')
  const theme =
    storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
}

applyTheme()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const storedTheme = localStorage.getItem('theme')
  if (storedTheme !== 'light' && storedTheme !== 'dark') applyTheme()
})

const client = createDesktopQueryClient()
subscribeDesktopChangeInvalidation({ queryClient: client })
performance.mark('rendererMounted')
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
)
