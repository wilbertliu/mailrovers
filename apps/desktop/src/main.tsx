import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.js'
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

const client = new QueryClient()
performance.mark('rendererMounted')
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
)
