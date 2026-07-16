import { cn } from '@/lib/utils'
import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon } from '@hugeicons/core-free-icons'

function Spinner({ className, strokeWidth = 2, ...props }: React.ComponentProps<'svg'>) {
  const numericStrokeWidth =
    typeof strokeWidth === 'number' ? strokeWidth : Number.parseFloat(strokeWidth)

  return (
    <HugeiconsIcon
      {...props}
      icon={Loading03Icon}
      strokeWidth={Number.isFinite(numericStrokeWidth) ? numericStrokeWidth : 2}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
    />
  )
}

export { Spinner }
