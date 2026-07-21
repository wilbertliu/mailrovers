'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Alert02Icon,
  MultiplicationSignCircleIcon,
  Loading03Icon,
} from '@hugeicons/core-free-icons'

type SonnerTheme = NonNullable<ToasterProps['theme']>

const toasterStyle: React.CSSProperties & Record<`--${string}`, string> = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
}

function normalizeSonnerTheme(theme: string | undefined): SonnerTheme {
  switch (theme) {
    case 'light':
    case 'dark':
    case 'system':
      return theme
    default:
      return 'system'
  }
}

const Toaster = ({ theme: callerTheme, ...props }: ToasterProps) => {
  const { theme: systemTheme } = useTheme()
  const theme = normalizeSonnerTheme(callerTheme ?? systemTheme)

  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />,
        info: <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" />,
        warning: <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />,
        error: (
          <HugeiconsIcon icon={MultiplicationSignCircleIcon} strokeWidth={2} className="size-4" />
        ),
        loading: (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-4 animate-spin" />
        ),
      }}
      style={toasterStyle}
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
      theme={theme}
    />
  )
}

export { Toaster }
