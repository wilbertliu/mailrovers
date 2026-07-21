import { formatMailAbsoluteDate, formatMailRelativeDate } from '@/lib/format-mail-time.js'
import { cn } from '@/lib/utils.js'

export function MailRelativeTime({
  value,
  className,
}: {
  value: string
  className?: string | undefined
}) {
  return (
    <time
      className={cn('text-xs font-normal text-muted-foreground', className)}
      dateTime={value}
      title={formatMailAbsoluteDate(value)}
    >
      {formatMailRelativeDate(value)}
    </time>
  )
}
