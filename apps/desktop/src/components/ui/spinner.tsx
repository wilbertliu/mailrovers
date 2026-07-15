/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG has no native status equivalent and is announced when used without a labelled action. */
import { cn } from '@/lib/utils'
import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon } from '@hugeicons/core-free-icons'

function Spinner({ className, ...props }: Omit<React.ComponentProps<'svg'>, 'strokeWidth'>) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={2}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
