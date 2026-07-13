import type { ConversationSummary } from '@mailrovers/mail-contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

export function ConversationVirtualList({
  items,
  onEnd,
}: {
  items: ConversationSummary[]
  onEnd: () => void
}) {
  const parent = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 64,
    overscan: 8,
  })
  return (
    <div
      ref={parent}
      onScroll={(event) => {
        const el = event.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 256) onEnd()
      }}
      style={{ height: 'calc(100vh - 80px)', overflow: 'auto' }}
      aria-label="Inbox"
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index]
          if (!item) return null
          return (
            <article
              key={item.id}
              style={{
                height: 64,
                transform: `translateY(${row.start}px)`,
                position: 'absolute',
                insetInline: 0,
              }}
            >
              <strong>{item.subject}</strong>
              <span>{item.snippet}</span>
              <time>{item.lastMessageAt}</time>
            </article>
          )
        })}
      </div>
    </div>
  )
}
