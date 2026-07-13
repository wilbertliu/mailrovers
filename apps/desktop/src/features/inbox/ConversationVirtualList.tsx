import type { ConversationSummary } from '@mailrovers/mail-contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

export function ConversationVirtualList({
  items,
  onEnd,
  onSelect,
  selectedId,
}: {
  items: ConversationSummary[]
  onEnd: () => void
  onSelect: (item: ConversationSummary) => void
  selectedId?: ConversationSummary['id'] | undefined
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
      style={{ height: 'calc(100vh - 136px)', overflow: 'auto' }}
      aria-label="Inbox"
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index]
          if (!item) return null
          return (
            <button
              type="button"
              key={item.id}
              className={selectedId === item.id ? 'conversation-row selected' : 'conversation-row'}
              onClick={() => onSelect(item)}
              style={{
                height: 64,
                transform: `translateY(${row.start}px)`,
                position: 'absolute',
                insetInline: 0,
              }}
            >
              <div className="conversation-subject">
                <strong>{item.subject || '(No subject)'}</strong>
                {item.unreadCount > 0 ? <span className="unread-dot" aria-label="Unread" /> : null}
              </div>
              <span>{item.snippet}</span>
              <time>{new Date(item.lastMessageAt).toLocaleDateString()}</time>
            </button>
          )
        })}
      </div>
    </div>
  )
}
