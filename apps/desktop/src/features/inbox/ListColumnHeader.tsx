import { Search01Icon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { IconTooltipButton } from '@/components/icon-tooltip-button.js'
import { Input } from '@/components/ui/input.js'
import { cn } from '@/lib/utils.js'

export function ListColumnHeader({
  title,
  subtitle,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  showSidebarToggle = false,
  onShowSidebar,
  trailing,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: (value: string) => void
  showSidebarToggle?: boolean | undefined
  onShowSidebar?: (() => void) | undefined
  trailing?: ReactNode
  className?: string | undefined
}) {
  return (
    <header className={cn('window-titlebar flex shrink-0 flex-col border-b', className)}>
      <div
        className={cn(
          'flex min-h-10 shrink-0 items-center gap-2 pt-0.5 pr-3',
          showSidebarToggle && onShowSidebar ? 'pl-21' : 'pl-4',
          subtitle ? 'py-1.5' : null,
        )}
      >
        {showSidebarToggle && onShowSidebar ? (
          <IconTooltipButton label="Show sidebar" icon={SidebarLeftIcon} onClick={onShowSidebar} />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        {trailing}
      </div>
      <form
        className="px-3 pb-2.5"
        aria-label="Search mail"
        onSubmit={(event) => {
          event.preventDefault()
          const value = new FormData(event.currentTarget).get('query')
          onSearchSubmit(typeof value === 'string' ? value : '')
        }}
      >
        <label className="sr-only" htmlFor="mail-search">
          Search mail
        </label>
        <div className="relative flex h-7 items-center">
          <span className="pointer-events-none absolute top-1/2 left-2.5 z-1 flex size-3.5 -translate-y-1/2 items-center justify-center text-muted-foreground">
            <HugeiconsIcon
              className="size-3.5"
              icon={Search01Icon}
              strokeWidth={2}
              aria-hidden="true"
            />
          </span>
          <Input
            className="h-7 rounded-md bg-muted/30 pr-2.5 pl-8 text-xs leading-none md:text-xs"
            id="mail-search"
            name="query"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder="Search"
          />
        </div>
      </form>
    </header>
  )
}
