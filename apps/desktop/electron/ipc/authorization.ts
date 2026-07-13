export type AuthorizedWebContents = { mainFrame: unknown }
export type AuthorizationEvent = {
  sender: AuthorizedWebContents
  senderFrame: { url: string } | null
}

export function isAllowedRendererUrl(actualUrl: string, expectedRendererUrl: string): boolean {
  try {
    const actual = new URL(actualUrl)
    const expected = new URL(expectedRendererUrl)
    return expected.protocol === 'file:'
      ? actual.href === expected.href
      : actual.origin === expected.origin
  } catch {
    return false
  }
}

export function isAuthorizedRequest(
  event: AuthorizationEvent,
  expectedWebContents: AuthorizedWebContents,
  expectedRendererUrl: string,
): boolean {
  return (
    event.sender === expectedWebContents &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame &&
    isAllowedRendererUrl(event.senderFrame.url, expectedRendererUrl)
  )
}
