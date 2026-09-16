import { Search, Bell, Moon, Sun } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'))
  useEffect(()=>{
    document.documentElement.classList.toggle('dark', dark)
  },[dark])
  return (
    <div className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b">
      <div className="flex h-16 items-center gap-4 px-4 lg:px-8">
        <div className="hidden lg:block min-w-0">
          <h1 className="text-lg font-semibold tracking-tight leading-none">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex-1 flex justify-center lg:justify-end">
          <div className="relative w-full max-w-md hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search jobs, companies, skills…" className="pl-9 h-9 rounded-full bg-muted/50 border-0" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={()=>setDark(!dark)} className="rounded-full">
            {dark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full relative">
            <Bell className="h-4 w-4"/>
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-violet-600 border-2 border-background" />
          </Button>
        </div>
      </div>
    </div>
  )
}
