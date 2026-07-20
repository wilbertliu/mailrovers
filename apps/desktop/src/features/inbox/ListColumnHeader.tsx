import { Search01Icon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button.js'
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
  onSearchSubmit: () => void
  showSidebarToggle?: boolean | undefined
  onShowSidebar?: (() => void) | undefined
  trailing?: ReactNode
  className?: string | undefined
}) {
  return (
    <header className={cn('window-titlebar flex shrink-0 flex-col border-b', className)}>
      {showSidebarToggle && onShowSidebar ? (
        <div className="flex h-10 shrink-0 items-center gap-3 pl-21 pt-0.5 pr-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-md"
            aria-label="Show sidebar"
            onClick={onShowSidebar}
          >
            <HugeiconsIcon icon={SidebarLeftIcon} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg tracking-tight">{title}</h1>
            {subtitle ? <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div> : null}
          </div>
          {trailing}
        </div>
        <form
          className="relative flex items-center"
          aria-label="Search mail"
          onSubmit={(event) => {
            event.preventDefault()
            onSearchSubmit()
          }}
        >
          <label className="sr-only" htmlFor="mail-search">
            Search mail
          </label>
          <HugeiconsIcon
            className="absolute left-2.5 z-1 text-muted-foreground"
            icon={Search01Icon}
            aria-hidden="true"
          />
          <Input
            className="h-9 rounded-md bg-muted/40 pr-3 pl-8 text-sm"
            id="mail-search"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder="Search"
          />
        </form>
      </div>
    </header>
  )
}
