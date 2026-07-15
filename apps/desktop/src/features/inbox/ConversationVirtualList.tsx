import type { ConversationSummary } from '@mailrovers/mail-contracts'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { cn } from '@/lib/utils.js'

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
            <button
              type="button"
              key={item.id}
              className={cn(
                'absolute inset-x-0 grid h-16 w-full grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-center gap-4 border-b border-[#e9edf1] bg-white px-3.5 py-2.5 text-start font-normal text-[#202722] transition-colors duration-150 motion-reduce:transition-none hover:bg-[#f5f7f5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4d735b] focus-visible:outline-none',
                selectedId === item.id && 'bg-[#e8efea]',
              )}
              onClick={() => onSelect(item)}
              style={{
                transform: `translateY(${row.start}px)`,
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <strong className="truncate">{item.subject || '(No subject)'}</strong>
                {item.unreadCount > 0 ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-[#39704d]"
                    aria-label="Unread"
                  />
                ) : null}
              </div>
              <span className="truncate text-[#68727f]">{item.snippet}</span>
              <time className="truncate text-xs text-[#68727f]">
                {new Date(item.lastMessageAt).toLocaleDateString()}
              </time>
            </button>
          )
        })}
      </div>
    </div>
  )
}
