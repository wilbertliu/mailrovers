import type { ConversationSummary } from '@mailrovers/mail-contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { Button } from '@/components/ui/button.js'

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
      className="h-[calc(100vh-136px)] overflow-auto"
      aria-label="Inbox"
    >
      <div className="relative" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index]
          if (!item) return null
          return (
            <Button
              type="button"
              key={item.id}
              className="absolute inset-x-0 grid h-16 w-full grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-center gap-4 px-3.5 py-2.5 text-start"
              aria-pressed={selectedId === item.id}
              onClick={() => onSelect(item)}
              style={{
                transform: `translateY(${row.start}px)`,
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <strong className="truncate">{item.subject || '(No subject)'}</strong>
                {item.unreadCount > 0 ? (
                  <span className="size-1.5 shrink-0" aria-label="Unread" />
                ) : null}
              </div>
              <span className="truncate">{item.snippet}</span>
              <time className="truncate">{new Date(item.lastMessageAt).toLocaleDateString()}</time>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
