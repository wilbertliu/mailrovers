import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.js'
import { ThemeProvider } from './components/theme-provider.js'
import { subscribeDesktopChangeInvalidation } from './desktop-change-invalidation.js'
import { createDesktopQueryClient } from './query-client.js'
import './styles.css'

const client = createDesktopQueryClient()
subscribeDesktopChangeInvalidation({ queryClient: client })
performance.mark('rendererMounted')
createRoot(document.getElementById('root')!).render(
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </ThemeProvider>,
)
