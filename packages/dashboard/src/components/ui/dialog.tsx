import * as React from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v:boolean)=>void; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={()=>onOpenChange(false)} />
      <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-auto animate-in">
        {children}
      </div>
    </div>
  )
}
export function DialogContent({ className, children, onClose }: { className?:string; children: React.ReactNode; onClose?:()=>void }) {
  return (
    <div className={cn('bg-card border rounded-2xl shadow-2xl p-6 m-4', className)}>
      {onClose && <button onClick={onClose} className="absolute right-6 top-6 p-1 rounded-lg hover:bg-accent"><X className="h-4 w-4"/></button>}
      {children}
    </div>
  )
}
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 mb-4', className)} {...props} />
}
export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />
}
export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}
