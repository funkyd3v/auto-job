import { Fragment, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

export default function Logs() {
  const [runs, setRuns] = useState<any[]>([])
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  async function load(){
    setLoading(true)
    try {
      const r=await api.getScrapeRuns({ limit:'10' } as any); setRuns((r as any).data ?? (r as any) ?? [])
      try { const n=await api.getNotifications({ limit: 10, page: 1 } as any); setNotifications((n as any).data ?? []) } catch {}
    } finally { setLoading(false) }
  }
  useEffect(()=>{ load() },[])

  function toggleExpand(id: string) {
    setExpandedRun(prev => prev === id ? null : id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Outbox → BullMQ → Telegram • idempotent ingest via <code className="bg-muted px-1 rounded">Idempotency-Key</code></p>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/> Refresh</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scrape runs</CardTitle>
          <CardDescription>pages, found / new / updated / duplicate / matched / notifications</CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 px-2 w-4"></th>
                <th className="text-left py-2 px-2">When</th>
                <th className="text-left py-2 px-2">Source</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-right py-2 px-2">Pages</th>
                <th className="text-right py-2 px-2">Found</th>
                <th className="text-right py-2 px-2">New</th>
                <th className="text-right py-2 px-2">Dup</th>
                <th className="text-right py-2 px-2">Matched</th>
                <th className="text-right py-2 px-2">Notifs</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r:any)=>{
                const hasError = r.status === 'FAILED' && (r.errorMessage ?? r.error_message)
                const isExpanded = expandedRun === r.id
                const sourceName = r.source?.name ?? r.source?.sourceType ?? r.sourceId ?? r.source_id
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-b last:border-0 hover:bg-muted/30 ${hasError ? 'cursor-pointer' : ''}`}
                      onClick={() => hasError && toggleExpand(r.id)}
                    >
                      <td className="py-2 px-2 w-4 text-muted-foreground">
                        {hasError ? (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
                      </td>
                      <td className="py-2 px-2 text-xs whitespace-nowrap">{new Date(r.startedAt ?? r.started_at).toLocaleString()}</td>
                      <td className="py-2 px-2 text-xs truncate max-w-[160px]" title={r.sourceId ?? r.source_id}>{sourceName}</td>
                      <td className="py-2 px-2"><Badge variant={r.status==='SUCCESS'?'success': r.status==='FAILED'?'danger':'secondary'}>{r.status}</Badge></td>
                      <td className="py-2 px-2 text-right text-xs">{r.pagesSuccessful ?? r.pages_successful}/{r.pagesAttempted ?? r.pages_attempted}</td>
                      <td className="py-2 px-2 text-right">{r.jobsFound ?? r.jobs_found}</td>
                      <td className="py-2 px-2 text-right text-emerald-600">{r.jobsNew ?? r.jobs_new}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{r.jobsDuplicate ?? r.jobs_duplicate}</td>
                      <td className="py-2 px-2 text-right font-medium">{r.jobsMatched ?? r.jobs_matched}</td>
                      <td className="py-2 px-2 text-right">{r.notificationsCreated ?? r.notifications_created}</td>
                    </tr>
                    {hasError && isExpanded && (
                      <tr key={`${r.id}-error`}>
                        <td colSpan={10} className="px-4 pb-3 pt-0">
                          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="danger">{r.errorCode ?? r.error_code}</Badge>
                              <span className="text-xs text-muted-foreground">Error detail</span>
                            </div>
                            <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words font-mono max-h-60 overflow-auto">
                              {r.errorMessage ?? r.error_message}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {runs.length===0 && <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">No runs yet</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>UNIQUE(job_id, channel, notification_type) — one per job</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {notifications.map((n:any)=>(
            <div key={n.id} className="flex items-center justify-between rounded-xl border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{n.job?.title ?? 'Unknown job'}{n.job?.company ? ` — ${n.job.company}` : ''}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{n.channel} / {n.notificationType ?? n.notification_type}</div>
              </div>
              <Badge variant={n.status==='SENT'?'success': n.status==='FAILED'?'danger':'secondary'}>{n.status} • {n.attempts} attempts</Badge>
            </div>
          ))}
          {notifications.length===0 && <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-xl">No notifications — will appear after qualifying jobs</div>}
        </CardContent>
      </Card>
    </div>
  )
}
