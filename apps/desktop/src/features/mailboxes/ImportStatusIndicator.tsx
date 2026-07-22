import { Button } from '@/components/ui/button.js'
import { Spinner } from '@/components/ui/spinner.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.js'

const IMPORT_STATUS_LABEL = 'Importing email'

export function ImportStatusIndicator({ label = IMPORT_STATUS_LABEL }: { label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-ml-1 rounded-md"
            aria-label={label}
          />
        }
      >
        <Spinner aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
