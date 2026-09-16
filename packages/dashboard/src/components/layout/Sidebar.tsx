import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Briefcase, Layers, Sparkles, Settings, ScrollText, LogOut, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/jobs', label: 'Jobs', icon: Briefcase },
  { to: '/sources', label: 'Sources', icon: Layers },
  { to: '/skills', label: 'Skills', icon: Sparkles },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: ()=>void }) {
  const { logout, email } = useAuthStore()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 px-5 border-b border-border/50">
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-sm leading-none">Job Hunter</div>
            <div className="text-[11px] text-muted-foreground">Automation • Phase 7</div>
          </div>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-auto">
        {nav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={()=>setMobileOpen(false)}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              collapsed && 'justify-center px-2'
            )}
          >
            <item.icon className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-border/50 space-y-3">
        {!collapsed && (
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="text-xs font-medium truncate">{email}</div>
            <div className="text-[11px] text-muted-foreground">Single-user owner</div>
          </div>
        )}
        <Button variant="outline" className="w-full justify-start gap-2" onClick={async()=>{ await logout(); navigate('/login') }}>
          <LogOut className="h-4 w-4"/> {!collapsed && 'Sign out'}
        </Button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop — fixed, only content scrolls */}
      <aside className={cn('hidden lg:flex flex-col h-screen sticky top-0 shrink-0 border-r bg-card/50 backdrop-blur transition-all duration-300 overflow-hidden', collapsed ? 'w-[72px]' : 'w-[260px]')}>
        <div className="flex justify-end p-2 shrink-0">
          <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7">
            <Menu className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
      </aside>

      {/* Mobile */}
      <div className="lg:hidden">
        <Button variant="ghost" size="icon" className="fixed left-3 top-3 z-40" onClick={()=>setMobileOpen(true)}>
          <Menu className="h-5 w-5"/>
        </Button>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div className="fixed inset-0 bg-black/50" onClick={()=>setMobileOpen(false)} />
            <div className="relative w-[280px] bg-card border-r shadow-xl">
              <Button variant="ghost" size="icon" className="absolute right-2 top-2" onClick={()=>setMobileOpen(false)}><X className="h-4 w-4"/></Button>
              {content}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
