import type { Preview } from '@storybook/react-vite'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { subscribeDesktopChangeInvalidation } from '../src/desktop-change-invalidation.js'
import { createDesktopQueryClient } from '../src/query-client.js'
import { installStorybookBridge } from '../src/storybook/mock-desktop-bridge.js'
import type { StorybookScenario } from '../src/storybook/storybook-scenarios.js'
import '../src/styles.css'

let activeQueryClient: QueryClient | undefined

function StoryEnvironment({
  children,
  queryClient,
}: {
  children: ReactNode
  queryClient: QueryClient
}) {
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
  beforeEach: (context) => {
    const scenario: StorybookScenario | undefined = context.parameters.mailrovers
    if (scenario === undefined)
      throw new Error(`Story ${context.id} must define parameters.mailrovers`)

    const theme = context.globals.theme === 'dark' ? 'dark' : 'light'
    const originalConfirm = window.confirm
    const originalPrompt = window.prompt
    const queryClient = createDesktopQueryClient({
      config: {
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      },
    })

    installStorybookBridge(scenario)
    const unsubscribeChanges = subscribeDesktopChangeInvalidation({ queryClient })
    activeQueryClient = queryClient
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
    if (scenario.dialogs?.confirm !== undefined)
      window.confirm = () => scenario.dialogs?.confirm ?? false
    if (scenario.dialogs && 'prompt' in scenario.dialogs)
      window.prompt = () => scenario.dialogs?.prompt ?? null

    return () => {
      unsubscribeChanges()
      window.confirm = originalConfirm
      window.prompt = originalPrompt
      queryClient.clear()
      if (activeQueryClient === queryClient) activeQueryClient = undefined
    }
  },
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
      const queryClient = activeQueryClient
      if (queryClient === undefined)
        throw new Error(`Story ${context.id} rendered before its environment was prepared`)
      return (
        <StoryEnvironment queryClient={queryClient}>
          <Story />
        </StoryEnvironment>
      )
    },
  ],
}

export default preview
