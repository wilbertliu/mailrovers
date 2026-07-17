import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Mailbox gate',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const Opening: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxOpening },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('Opening your local mailbox…'),
    ).toBeVisible()
  },
}

export const FailedToOpen: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxError },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      "Couldn't open your local mailbox.",
    )
  },
}

export const Retrying: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxRetrying },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Retry' }))
    await expect(await canvas.findByRole('button', { name: 'Retrying…' })).toBeDisabled()
  },
}

export const NoAccountConnected: Story = {
  parameters: { mailrovers: storybookScenarios.noAccounts },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { name: 'Before you connect' }),
    ).toBeVisible()
  },
}

export const WaitingForGoogle: Story = {
  parameters: { mailrovers: storybookScenarios.connecting },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await expect(await canvas.findByRole('button', { name: 'Waiting for Google…' })).toBeDisabled()
  },
}

export const CancellingGoogleConnection: Story = {
  parameters: { mailrovers: storybookScenarios.cancellingConnection },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel' }))
    await expect(await canvas.findByRole('button', { name: 'Cancelling…' })).toBeDisabled()
  },
}

export const AddAnotherAccount: Story = {
  parameters: { mailrovers: storybookScenarios.addAccount },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Add Gmail account' }))
    await expect(await canvas.findByRole('heading', { name: 'Before you connect' })).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Back' })).toBeVisible()
  },
}

export const GoogleConnectionFailed: Story = {
  parameters: { mailrovers: storybookScenarios.connectFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await expect(
      await canvas.findByText('Google authorization could not be completed.'),
    ).toBeVisible()
  },
}

export const GoogleCancellationFailed: Story = {
  parameters: { mailrovers: storybookScenarios.cancelConnectionFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel' }))
    await expect(
      await canvas.findByText('The authorization window could not be cancelled.'),
    ).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Cancel' })).toBeEnabled()
  },
}

export const GoogleConnectionSucceeded: Story = {
  parameters: { mailrovers: storybookScenarios.connectionSucceeded },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await expect(await canvas.findByRole('heading', { name: 'Gmail connected' })).toBeVisible()
    await expect(await canvas.findByRole('textbox', { name: 'Search mail' })).toBeVisible()
    await expect(await canvas.findByText('Importing older mail')).toBeVisible()
  },
}
