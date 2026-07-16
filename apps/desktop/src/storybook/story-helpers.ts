import { expect, userEvent, within } from 'storybook/test'

export async function openLaunchConversation(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(
    await canvas.findByRole('button', { name: /Launch checklist and final copy/i }),
  )
  await expect(
    await canvas.findByRole('heading', { name: 'Launch checklist and final copy' }),
  ).toBeVisible()
  return canvas
}
