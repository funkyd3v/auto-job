import * as React from 'react'
import { cn } from '@/lib/utils'

const variants: Record<string, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border text-foreground',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  danger: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20',
}

export function Badge({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: keyof typeof variants }) {
  return <div className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition', variants[variant], className)} {...props} />
}
