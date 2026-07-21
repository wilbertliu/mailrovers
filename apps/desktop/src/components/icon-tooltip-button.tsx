import type { ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.js'
import { cn } from '@/lib/utils.js'

export function IconTooltipButton({
  label,
  icon,
  onClick,
  disabled,
  variant = 'ghost',
  size = 'icon-sm',
  className,
}: {
  label: string
  icon: ComponentProps<typeof HugeiconsIcon>['icon']
  onClick?: (() => void) | undefined
  disabled?: boolean | undefined
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string | undefined
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size={size}
            className={cn('rounded-md', className)}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <HugeiconsIcon icon={icon} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
