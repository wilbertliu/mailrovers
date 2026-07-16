import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Search',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

async function submitSearch(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.type(await canvas.findByRole('textbox', { name: 'Search mail' }), 'launch{Enter}')
  await expect(await canvas.findByRole('heading', { name: 'Search' })).toBeVisible()
  return canvas
}

export const Results: Story = {
  parameters: { mailrovers: storybookScenarios.searchResults },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
    await expect(await canvas.findByText(/attached launch checklist/i)).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: { mailrovers: storybookScenarios.searchLoading },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
    await expect(await canvas.findByText('No local results.')).toBeVisible()
  },
}

export const NoResults: Story = {
  parameters: { mailrovers: storybookScenarios.searchEmpty },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
    await expect(await canvas.findByText('No local results.')).toBeVisible()
  },
}

export const IndexingOlderMail: Story = {
  parameters: { mailrovers: storybookScenarios.searchIndexing },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
    await expect(await canvas.findByText('Indexing older mail…')).toBeVisible()
  },
}

export const Failed: Story = {
  parameters: { mailrovers: storybookScenarios.searchError },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Retry loading results' })).toBeVisible()
  },
}

export const ResultSelected: Story = {
  parameters: { mailrovers: storybookScenarios.searchResults },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /Launch checklist and final copy/ }),
    )
    await expect(
      await canvas.findByRole('region', { name: 'Launch checklist and final copy' }),
    ).toBeVisible()
  },
}
