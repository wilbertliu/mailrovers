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

import { cn } from '@/lib/utils'

interface ToasterStyle extends React.CSSProperties {
  [property: `--${string}`]: string
}

const semanticIconClasses = {
  success: '[&_[data-icon]]:text-[var(--success-text)]',
  info: '[&_[data-icon]]:text-[var(--info-text)]',
  warning: '[&_[data-icon]]:text-[var(--warning-text)]',
  error: '[&_[data-icon]]:text-destructive',
}

const quietToastClasses = {
  toast:
    '!w-fit !max-w-(--toast-max-width) !gap-2 !rounded-xl !border-border !bg-popover !p-3 !text-popover-foreground !shadow-md data-[x-position=center]:!inset-x-0 data-[x-position=center]:!mx-auto',
  content: '!min-w-0 !gap-0.5',
  title: '!text-sm !font-medium',
  description: '!text-muted-foreground',
  icon: 'self-start !mt-0.5',
  actionButton: '!h-7 !rounded-full !bg-secondary !px-3 !text-secondary-foreground hover:!bg-muted',
  cancelButton: '!h-7 !rounded-full !bg-transparent !px-3 !text-muted-foreground',
  closeButton: '!border-border !bg-popover !text-muted-foreground',
  ...semanticIconClasses,
} satisfies NonNullable<ToasterProps['toastOptions']>['classNames']

const Toaster = ({ theme: requestedTheme, className, toastOptions, ...props }: ToasterProps) => {
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
    '--toast-max-width': 'min(24rem, calc(100vw - 2rem))',
    '--toast-icon-margin-start': '0px',
    '--toast-icon-margin-end': '0px',
  } satisfies ToasterStyle

  return (
    <Sonner
      {...props}
      theme={toasterTheme}
      className={cn('toaster group', className)}
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
        ...toastOptions,
        classNames: {
          ...quietToastClasses,
          ...toastOptions?.classNames,
        },
      }}
    />
  )
}

export { Toaster }
