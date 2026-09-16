import * as React from 'react'
import { cn } from '@/lib/utils'

export function Tabs({ value, onValueChange, children, className }: { value: string; onValueChange:(v:string)=>void; children: React.ReactNode; className?:string }) {
  return <div className={cn('', className)} data-value={value}>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child as any, { _value: value, _onValueChange: onValueChange }) : child)}</div>
}
export function TabsList({ children, className, _value, _onValueChange }: any) {
  return <div className={cn('inline-flex h-10 items-center justify-center rounded-xl bg-muted p-1', className)}>{React.Children.map(children, (c:any)=> React.cloneElement(c, {_value,_onValueChange}))}</div>
}
export function TabsTrigger({ value, children, _value, _onValueChange }: any) {
  const active = _value===value
  return <button onClick={()=>_onValueChange(value)} className={cn('px-3 py-1.5 text-sm font-medium rounded-lg transition', active?'bg-card shadow-sm text-foreground':'text-muted-foreground hover:text-foreground')}>{children}</button>
}
export function TabsContent({ value, children, _value }: any) {
  if (_value!==value) return null
  return <div className="mt-4">{children}</div>
}
