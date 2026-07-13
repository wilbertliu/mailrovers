export function splitUtf8(value: string, maxBytes: number): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be positive')
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength
    if (currentBytes + characterBytes > maxBytes && current.length > 0) {
      parts.push(current)
      current = ''
      currentBytes = 0
    }
    current += character
    currentBytes += characterBytes
  }
  if (current.length > 0) parts.push(current)
  return parts
}
