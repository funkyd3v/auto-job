import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useState } from 'react'

const titles: Record<string, { title: string; subtitle: string }> = {
  '/overview': { title: 'Overview', subtitle: 'Pipeline health & matching performance' },
  '/jobs': { title: 'Jobs', subtitle: 'Deduplicated pipeline — one logical job, one record' },
  '/sources': { title: 'Sources', subtitle: 'LinkedIn, bdjobs, NextJobzBD & custom boards' },
  '/skills': { title: 'Skills', subtitle: 'Weights, types & aliases — live match preview' },
  '/logs': { title: 'Logs', subtitle: 'Scrape runs & notifications' },
  '/settings': { title: 'Settings', subtitle: 'Threshold, API keys & Telegram' },
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const loc = useLocation()
  const meta = titles[loc.pathname] || titles['/overview']
  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onToggle={()=>setCollapsed(v=>!v)} />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Topbar title={meta.title} subtitle={meta.subtitle} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 bg-gradient-to-b from-background to-muted/20">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
