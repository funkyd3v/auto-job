import * as React from 'react'
import { cn } from '@/lib/utils'

export function AlertDialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v:boolean)=>void; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={()=>onOpenChange(false)} />
      <div className="relative z-50 w-full max-w-md animate-in fade-in-0 zoom-in-95">
        {children}
      </div>
    </div>
  )
}
export function AlertDialogContent({ className, children }: { className?:string; children: React.ReactNode }) {
  return <div className={cn('bg-card border rounded-2xl shadow-2xl p-6 m-4', className)}>{children}</div>
}
export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 mb-2', className)} {...props} />
}
export function AlertDialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />
}
export function AlertDialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}
export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-6', className)} {...props} />
}