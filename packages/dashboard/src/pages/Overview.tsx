import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Briefcase, Target, BellRing, Layers, TrendingUp, Activity, ArrowUpRight, Sparkles } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'

function Kpi({ icon: Icon, label, value, hint, trend }: any) {
  return (
    <Card className="overflow-hidden border-border/60 hover:shadow-lg transition">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow">
            <Icon className="h-5 w-5 text-white" />
          </div>
          {trend && <span className="text-xs font-medium text-emerald-600 flex items-center gap-1"><TrendingUp className="h-3 w-3"/>{trend}</span>}
        </div>
        <div className="mt-4">
          <div className="text-2xl font-bold tracking-tight">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Overview() {
  const [jobs, setJobs] = useState<any[]>([])
  const [sources, setSources] = useState<any[]>([])
  const [runs, setRuns] = useState<any[]>([])
  const [settings, setSettings] = useState<{min_match_percentage:number} | null>(null)
  const [notifCount, setNotifCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    Promise.allSettled([
      api.getJobs({ limit: '100' }).then(r=>setJobs(r.data)),
      api.getSources().then(r=>setSources(r.data)),
      api.getScrapeRuns({}).then(r=>setRuns((r as any).data ?? [])),
      api.getMatchSettings().then(r=>setSettings(r.data)),
      api.getNotifications({}).then(r=>setNotifCount((r as any).pagination?.total ?? ((r as any).data?.length ?? 0))),
    ]).finally(()=>setLoading(false))
  },[])

  const matched = jobs.filter(j=> (j.matchScore ?? j.match_score) >= (settings?.min_match_percentage ?? 70)).length
  const funnel = [
    { name: 'NEW', value: jobs.filter(j=>j.status==='NEW').length },
    { name: 'SAVED', value: jobs.filter(j=>j.status==='SAVED').length },
    { name: 'APPLIED', value: jobs.filter(j=>j.status==='APPLIED').length },
    { name: 'INTERVIEW', value: jobs.filter(j=>j.status==='INTERVIEW').length },
    { name: 'OFFER', value: jobs.filter(j=>j.status==='OFFER').length },
  ]
  const dist = [0,20,40,60,80].map(s=> ({ bucket: `${s}-${s+19}%`, count: jobs.filter(j=> { const sc=j.matchScore??j.match_score??0; return sc>=s && sc < s+20 }).length }))
  dist.push({ bucket: '80-100%', count: jobs.filter(j=> (j.matchScore??j.match_score??0) >=80).length })

  if (loading) return <div className="grid gap-4 md:grid-cols-4 animate-pulse"><div className="h-32 bg-muted rounded-2xl"/><div className="h-32 bg-muted rounded-2xl"/><div className="h-32 bg-muted rounded-2xl"/><div className="h-32 bg-muted rounded-2xl"/></div>

  return (
    <div className="space-y-6">
      {/* hero banner */}
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-violet-600 via-indigo-600 to-fuchsia-600 text-white">
        <CardContent className="p-6 lg:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur border border-white/20">
              <Activity className="h-3.5 w-3.5"/> Phase 7 • Extension matches locally
            </div>
            <h2 className="text-2xl font-bold mt-3">Your pipeline at a glance</h2>
            <p className="text-white/80 text-sm mt-1 max-w-xl">Jobs are deduplicated by <code className="bg-white/20 px-1.5 py-0.5 rounded text-xs">job_fingerprint</code> &amp; <code className="bg-white/20 px-1.5 py-0.5 rounded text-xs">(source, external_id)</code>. One notification per job guaranteed.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white text-violet-700 px-5 py-3 text-center min-w-[110px]">
              <div className="text-2xl font-extrabold leading-none">{settings?.min_match_percentage ?? 70}%</div>
              <div className="text-[11px] font-medium tracking-widest">THRESHOLD</div>
            </div>
            <Button variant="secondary" className="bg-white text-violet-700 hover:bg-white/90">View Jobs <ArrowUpRight className="h-4 w-4"/></Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Briefcase} label="Total jobs" value={jobs.length} hint={`${matched} ≥ threshold`} trend="+ live" />
        <Kpi icon={Target} label="Matching jobs" value={matched} hint={`≥ ${settings?.min_match_percentage ?? 70}% match score`} />
        <Kpi icon={Layers} label="Sources" value={sources.length} hint={`${sources.filter(s=>s.is_enabled ?? s.isEnabled).length} enabled`} />
        <Kpi icon={BellRing} label="Notifications" value={notifCount} hint="via Telegram • deduplicated" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600"/> Match distribution</CardTitle>
            <CardDescription>Score buckets — how many jobs per range</CardDescription>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist}>
                <XAxis dataKey="bucket" tick={{ fontSize: 12 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
                <Bar dataKey="count" radius={[8,8,0,0]} fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <CardDescription>NEW → OFFER pipeline</CardDescription>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={funnel}>
                <XAxis dataKey="name" tick={{fontSize:12}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:12}} axisLine={false} tickLine={false}/>
                <Tooltip/>
                <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent scrape runs</CardTitle>
            <CardDescription>Latest 5 runs • status &amp; notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runs.slice(0,5).map((r:any)=>(
              <div key={r.id} className="flex items-center justify-between rounded-xl border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.source?.name ?? r.source?.sourceType ?? r.sourceId ?? r.source_id ?? 'source'}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.startedAt ?? r.started_at).toLocaleString()} • found {r.jobsFound ?? r.jobs_found} • matched {r.jobsMatched ?? r.jobs_matched}</div>
                </div>
                <Badge variant={r.status==='SUCCESS' ? 'success' : r.status==='FAILED' ? 'danger' : 'secondary'}>{r.status}</Badge>
              </div>
            ))}
            {runs.length===0 && <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-xl">No runs yet — trigger extension scrape</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Source health</CardTitle>
            <CardDescription>Enabled &amp; schedule</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sources.map((s:any)=>(
              <div key={s.id} className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">{s.name} <Badge variant="outline" className="capitalize text-[11px]">{s.source_type ?? s.sourceType}</Badge></div>
                  <div className="text-xs text-muted-foreground">{s.base_url ?? s.baseUrl} • {s.schedule}</div>
                </div>
                <Badge variant={(s.is_enabled ?? s.isEnabled) ? 'success' : 'secondary'}>{(s.is_enabled ?? s.isEnabled) ? 'Enabled' : 'Disabled'}</Badge>
              </div>
            ))}
            {sources.length===0 && <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-xl">No sources — add LinkedIn / bdjobs / NextJobzBD</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
