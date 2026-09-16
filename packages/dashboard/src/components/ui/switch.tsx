import * as React from 'react'
import { cn } from '@/lib/utils'

export function Switch({ checked, onCheckedChange, className, ...props }: { checked?: boolean; onCheckedChange?: (v:boolean)=>void } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>,'onChange'>) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={()=> onCheckedChange?.(!checked)}
      className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', checked ? 'bg-primary' : 'bg-input', className)}
      {...props}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}
