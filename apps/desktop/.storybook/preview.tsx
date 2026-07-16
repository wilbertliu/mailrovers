import type { Preview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useEffect, useState, type ReactNode } from 'react'
import { installStorybookBridge } from '../src/storybook/mock-desktop-bridge.js'
import type { StorybookScenario } from '../src/storybook/storybook-scenarios.js'
import '../src/styles.css'

function StoryEnvironment({
  children,
  scenario,
  theme,
}: {
  children: ReactNode
  scenario: StorybookScenario
  theme: 'light' | 'dark'
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  )

  installStorybookBridge(scenario)

  useEffect(() => {
    const originalConfirm = window.confirm
    const originalPrompt = window.prompt
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
    if (scenario.dialogs?.confirm !== undefined)
      window.confirm = () => scenario.dialogs?.confirm ?? false
    if (scenario.dialogs && 'prompt' in scenario.dialogs)
      window.prompt = () => scenario.dialogs?.prompt ?? null
    return () => {
      window.confirm = originalConfirm
      window.prompt = originalPrompt
      queryClient.clear()
    }
  }, [queryClient, scenario, theme])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Renderer color scheme',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktop' },
    a11y: { test: 'todo' },
    options: {
      storySort: {
        order: [
          'Flows',
          ['Mailbox gate', 'Import', 'Workspace', 'Search', 'Conversation', 'Composer', 'AI'],
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const scenario = context.parameters.mailrovers as StorybookScenario | undefined
      if (scenario === undefined)
        throw new Error(`Story ${context.id} must define parameters.mailrovers`)
      const theme = context.globals.theme === 'dark' ? 'dark' : 'light'
      return (
        <StoryEnvironment key={`${context.id}:${theme}`} scenario={scenario} theme={theme}>
          <Story />
        </StoryEnvironment>
      )
    },
  ],
}

export default preview
