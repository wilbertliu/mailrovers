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

export async function submitSearch(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const search = await canvas.findByRole('textbox', { name: 'Search mail' })
  await userEvent.type(search, 'launch', { delay: 5 })
  await expect(search).toHaveValue('launch')
  await userEvent.tab()
  await userEvent.click(search)
  await userEvent.keyboard('{Enter}')
  await expect(await canvas.findByRole('heading', { name: 'Search' })).toBeVisible()
  return canvas
}
