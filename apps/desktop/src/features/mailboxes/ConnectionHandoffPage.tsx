import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty.js'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker.js'
import { Spinner } from '@/components/ui/spinner.js'

export function ConnectionHandoffPage({ emailAddress }: { emailAddress: string }) {
  return (
    <main className="grid h-full place-items-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Gmail connected</h1>
          </EmptyTitle>
          <EmptyDescription>
            {emailAddress} is ready. Opening your inbox as soon as the first messages arrive.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Marker className="w-auto" render={<output aria-live="polite" />}>
            <MarkerIcon>
              <Spinner aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>Older mail will continue importing in the background</MarkerContent>
          </Marker>
        </EmptyContent>
      </Empty>
    </main>
  )
}
