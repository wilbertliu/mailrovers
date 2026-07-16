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

interface ToasterStyle extends React.CSSProperties {
  [property: `--${string}`]: string
}

const Toaster = ({ theme: requestedTheme, ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const toasterTheme =
    requestedTheme ??
    (theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system')
  const style = {
    color: 'inherit',
    '--normal-bg': 'var(--popover)',
    '--normal-text': 'var(--popover-foreground)',
    '--normal-border': 'var(--border)',
    '--border-radius': 'var(--radius)',
  } satisfies ToasterStyle

  return (
    <Sonner
      {...props}
      theme={toasterTheme}
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
      style={style}
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
    />
  )
}

export { Toaster }
