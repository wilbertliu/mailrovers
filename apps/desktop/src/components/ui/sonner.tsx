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
    'flex items-center gap-2 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[x-position=center]:inset-x-0 data-[x-position=center]:mx-auto data-[expanded=false]:data-[front=false]:[&>*]:opacity-0',
  content: 'flex min-w-0 flex-col gap-0.5',
  title: 'font-medium leading-5',
  description: 'leading-5 text-muted-foreground opacity-80',
  icon: 'relative mt-0.5 flex size-4 shrink-0 self-start items-center justify-center',
  actionButton:
    'ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center rounded-full bg-secondary px-3 text-xs font-medium text-secondary-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
  cancelButton:
    'ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center rounded-full bg-transparent px-3 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
  closeButton:
    'absolute -top-2 -left-2 z-10 flex size-5 cursor-pointer items-center justify-center rounded-full border border-border bg-popover p-0 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50',
  ...semanticIconClasses,
} satisfies NonNullable<ToasterProps['toastOptions']>['classNames']

const Toaster = ({
  theme: requestedTheme,
  className,
  style: requestedStyle,
  icons: requestedIcons,
  toastOptions,
  ...props
}: ToasterProps) => {
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
    ...requestedStyle,
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
        ...requestedIcons,
      }}
      style={style}
      toastOptions={{
        ...toastOptions,
        unstyled: true,
        style: {
          width: 'fit-content',
          maxWidth: 'var(--toast-max-width)',
          ...toastOptions?.style,
        },
        classNames: {
          ...quietToastClasses,
          ...toastOptions?.classNames,
        },
      }}
    />
  )
}

export { Toaster }
