import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { openLaunchConversation } from './storybook/story-helpers.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/AI',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

async function openAiSettings(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'AI provider' }))
  await expect(await canvas.findByRole('heading', { name: 'AI provider' })).toBeVisible()
  return canvas
}

export const SettingsConfigured: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettings },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await expect(await canvas.findByDisplayValue('gpt-5-mini')).toBeVisible()
    await expect(await canvas.findByText('Connection verified.')).toBeVisible()
  },
}

export const SettingsFailedToLoad: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsError },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load AI settings.')
  },
}

export const SettingsLoading: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsLoading },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await expect(await canvas.findByText('Loading AI settings…')).toBeVisible()
  },
}

export const SettingsNotConfigured: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsUnconfigured },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Save settings' })).toBeDisabled()
    await expect(await canvas.findByPlaceholderText('Required')).toBeVisible()
  },
}

export const SettingsSaving: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsSaving },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Save settings' }))
    await expect(await canvas.findByRole('button', { name: 'Saving…' })).toBeDisabled()
  },
}

export const SettingsSaveFailed: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsSaveFailed },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Save settings' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI provider settings could not be saved.',
    )
  },
}

export const SettingsTesting: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsTesting },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Test connection' }))
    await expect(await canvas.findByRole('button', { name: 'Testing…' })).toBeDisabled()
  },
}

export const SettingsTestFailed: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsTestFailed },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Test connection' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI provider could not be reached.',
    )
  },
}

export const SettingsRemoved: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsRemoved },
  play: async ({ canvasElement }) => {
    const canvas = await openAiSettings(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Remove AI configuration' }))
    await expect(await canvas.findByPlaceholderText('Required')).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Save settings' })).toBeDisabled()
  },
}

async function startSummary(canvasElement: HTMLElement) {
  const canvas = await openLaunchConversation(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'Summarize conversation' }))
  return canvas
}

export const SummaryStreaming: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryStreaming },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(
      await canvas.findByRole('region', { name: 'Conversation summary' }),
    ).toHaveTextContent(/Maya completed the launch review/)
    await expect(await canvas.findByRole('button', { name: 'Cancel' })).toBeVisible()
  },
}

export const SummaryComplete: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryComplete },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(
      await canvas.findByRole('region', { name: 'Conversation summary' }),
    ).toHaveTextContent(/asked Alex to verify the attached PDF/)
    await expect(await canvas.findByRole('button', { name: 'Regenerate' })).toBeVisible()
  },
}

export const SummaryFailed: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryError },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI provider is temporarily unavailable.',
    )
  },
}

export const SummaryCouldNotStart: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryStartFailed },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI summary could not be started.',
    )
  },
}
