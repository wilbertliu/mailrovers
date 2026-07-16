import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Import',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

function importStory(
  mailrovers: (typeof storybookScenarios)[keyof typeof storybookScenarios],
  heading: string,
): Story {
  return {
    parameters: { mailrovers },
    play: async ({ canvasElement }) => {
      await expect(
        await within(canvasElement).findByRole('heading', { name: heading }),
      ).toBeVisible()
    },
  }
}

export const Estimating = importStory(storybookScenarios.importEstimating, 'Preparing import')
export const ImportingLabels = importStory(storybookScenarios.importLabels, 'Importing labels')
export const ImportingMessages = importStory(
  storybookScenarios.importMessages,
  'Importing messages',
)
export const ImportingDrafts = importStory(storybookScenarios.importDrafts, 'Importing drafts')
export const ReconcilingHistory = importStory(
  storybookScenarios.importReconciling,
  'Checking for changes during import',
)
export const Paused = importStory(storybookScenarios.importPaused, 'Import paused')
export const Failed = importStory(storybookScenarios.importFailed, 'Import needs attention')
export const AuthorizationRequired = importStory(
  storybookScenarios.importAuthRequired,
  'Gmail needs to be connected again',
)

export const StatusUnavailable: Story = {
  parameters: { mailrovers: storybookScenarios.importStatusError },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/current import status/i)).toBeVisible()
  },
}

export const CouldNotStart: Story = {
  parameters: { mailrovers: storybookScenarios.importStartFailed },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/Gmail import could not be resumed/i),
    ).toBeVisible()
  },
}

export const Pausing: Story = {
  parameters: { mailrovers: storybookScenarios.importPausing },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Pause import' }))
    await expect(await canvas.findByRole('button', { name: 'Pausing…' })).toBeDisabled()
  },
}

export const Resuming: Story = {
  parameters: { mailrovers: storybookScenarios.importResuming },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Resume import' }))
    await expect(await canvas.findByRole('button', { name: 'Resuming…' })).toBeDisabled()
  },
}

export const Retrying: Story = {
  parameters: { mailrovers: storybookScenarios.importRetrying },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Retry import' }))
    await expect(await canvas.findByRole('button', { name: 'Retrying…' })).toBeDisabled()
  },
}

export const Disconnecting: Story = {
  parameters: { mailrovers: storybookScenarios.importDisconnecting },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Disconnect' }))
    await expect(await canvas.findByRole('button', { name: 'Disconnecting…' })).toBeDisabled()
  },
}
