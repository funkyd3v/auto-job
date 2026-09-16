import * as React from 'react'
import { cn } from '@/lib/utils'

export function Slider({ value, min=0, max=100, step=1, onValueChange, className, ...props }: { value: number; min?:number; max?:number; step?:number; onValueChange?:(v:number)=>void } & Omit<React.InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'>) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={cn('relative flex items-center w-full py-2', className)}>
      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onValueChange?.(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        {...props}
      />
      <div className="absolute h-5 w-5 rounded-full bg-white shadow-lg border-2 border-violet-600 pointer-events-none transition-all" style={{ left: `calc(${pct}% - 10px)` }} />
    </div>
  )
}
