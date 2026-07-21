import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
  format,
} from 'date-fns'

export function formatMailAbsoluteDate(value: Date | string | number): string {
  return format(new Date(value), 'MMM d, yyyy')
}

/** Compact relative age for dense mail UI: `3h`, `1d`, `2w`, … */
export function formatMailRelativeDate(
  value: Date | string | number,
  now: Date | string | number = Date.now(),
): string {
  const date = new Date(value)
  const reference = new Date(now)
  const minutes = differenceInMinutes(reference, date)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = differenceInHours(reference, date)
  if (hours < 24) return `${hours}h`
  const days = differenceInDays(reference, date)
  if (days < 7) return `${days}d`
  const weeks = differenceInWeeks(reference, date)
  if (weeks < 5) return `${weeks}w`
  const months = differenceInMonths(reference, date)
  if (months < 12) return `${months}mo`
  return `${differenceInYears(reference, date)}y`
}
