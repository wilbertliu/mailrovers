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
    estimateSize: () => 84,
    overscan: 8,
  })
  return (
    <div
      ref={parent}
      onScroll={(event) => {
        const el = event.currentTarget
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 256) onEnd()
      }}
      className="min-h-0 flex-1 overflow-auto p-1.5"
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
              variant="ghost"
              className="absolute inset-x-0 grid h-21 w-full grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2.5 py-3 text-start text-sm font-medium aria-pressed:bg-accent"
              aria-pressed={selectedId === item.id}
              data-unread={item.unreadCount > 0}
              onClick={() => onSelect(item)}
              style={{
                transform: `translateY(${row.start}px)`,
              }}
            >
              <span
                className="mt-1.5 size-1.5 rounded-full bg-transparent data-[unread=true]:bg-primary"
                data-unread={item.unreadCount > 0}
                aria-label={item.unreadCount > 0 ? 'Unread' : undefined}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <strong className="truncate text-sm">{item.subject || '(No subject)'}</strong>
                <span className="truncate text-sm font-normal text-muted-foreground">
                  {item.snippet}
                </span>
              </div>
              <time className="truncate text-sm font-normal text-muted-foreground">
                {new Date(item.lastMessageAt).toLocaleDateString()}
              </time>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
