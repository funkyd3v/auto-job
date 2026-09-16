import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, ExternalLink, RefreshCw, Filter, Trash2, AlertTriangle } from 'lucide-react'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog'

const statuses = ['', 'NEW','SAVED','APPLIED','INTERVIEW','OFFER','HIRED','REJECTED','ARCHIVED']

function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const color = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-muted-foreground'
  return (
    <div className={`h-10 w-10 rounded-full border-4 flex items-center justify-center text-xs font-bold ${color}`} style={{ borderColor: pct>=70 ? 'hsl(var(--primary))' : 'hsl(var(--border))', background: `conic-gradient(hsl(var(--primary)) ${pct}%, transparent 0)` }}>
      <span className="bg-card rounded-full h-7 w-7 flex items-center justify-center">{pct}%</span>
    </div>
  )
}

export default function Jobs() {
  const [jobs, setJobs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<any|null>(null)
  const [kanban, setKanban] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any|null>(null)

  async function load(p=1) {
    setLoading(true)
    try {
      const res = await api.getJobs({ page: String(p), limit: '20', ...(search ? { search }:{}), ...(status ? { status }:{}), sort_by: 'match_score', sort_order: 'desc' } as any)
      setJobs(res.data); setTotal(res.pagination.total); setPage(res.pagination.page)
    } finally { setLoading(false) }
  }

  function deleteJob(j: any) {
    setDeleteTarget(j)
  }

  async function confirmDelete() {
    const job = deleteTarget
    if (!job) return
    setDeleteTarget(null)
    await api.deleteJob(job.id)
    if (selected?.id === job.id) setSelected(null)
    load(page)
  }
  useEffect(()=>{ load(1) },[])
  useEffect(()=>{ const t=setTimeout(()=>load(1),400); return ()=>clearTimeout(t) },[search, status])

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="p-4 flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
            <Input placeholder="Search title, company, location…" className="pl-9" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-2 rounded-xl border px-3 bg-card">
              <Filter className="h-4 w-4 text-muted-foreground"/>
              <select value={status} onChange={e=>setStatus(e.target.value)} className="bg-transparent text-sm focus:outline-none">
                {statuses.map(s=> <option key={s} value={s}>{s || 'All statuses'}</option>)}
              </select>
            </div>
            <Button variant="outline" onClick={()=>load(page)}><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/></Button>
            <Button variant={kanban ? 'default':'outline'} onClick={()=>setKanban(!kanban)}>{kanban ? 'Table' : 'Kanban'}</Button>
          </div>
        </CardContent>
      </Card>

      {!kanban ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{total} jobs • page {page} • sorted by match score</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-y bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Job</th>
                  <th className="text-left px-4 py-2 font-medium">Match</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Source</th>
                  <th className="text-right px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j=>{
                  const score = j.matchScore ?? j.match_score ?? 0
                  return (
                    <tr key={j.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={()=>setSelected(j)}>
                      <td className="px-4 py-3">
                        <div className="font-medium leading-none truncate max-w-[320px]">{j.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{j.company} • {j.location ?? 'Remote'} • {new Date(j.scrapedAt ?? j.scraped_at ?? j.createdAt).toLocaleDateString()}</div>
                      </td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><ScoreRing score={score}/><span className="text-xs text-muted-foreground hidden lg:inline">{(j.matchedSkills ?? j.matched_skills ?? []).filter((s:any)=>s.matched).length} skills</span></div></td>
                      <td className="px-4 py-3"><Badge variant={j.status==='NEW'?'secondary': j.status==='APPLIED'?'default':'outline'}>{j.status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[160px]">{j.sourceId ?? j.source_id}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <a href={j.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Open <ExternalLink className="h-3 w-3"/></a>
                          <Button variant="ghost" size="icon" title="Delete job" onClick={(e)=>{ e.stopPropagation(); deleteJob(j) }} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5"/></Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {jobs.length===0 && !loading && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No jobs — adjust filters or run scraper</td></tr>}
              </tbody>
            </table>
            <div className="flex items-center justify-between p-4">
              <div className="text-xs text-muted-foreground">{total} total • {jobs.length} on page</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page<=1} onClick={()=>load(page-1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={jobs.length<20} onClick={()=>load(page+1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          {statuses.filter(Boolean).map(s=>{
            const col = jobs.filter(j=>j.status===s)
            return (
              <Card key={s} className="bg-muted/20">
                <CardHeader className="pb-2"><CardTitle className="text-xs tracking-widest">{s} • {col.length}</CardTitle></CardHeader>
                <CardContent className="space-y-2 min-h-[200px]">
                  {col.map(j=>(
                    <div key={j.id} onClick={()=>setSelected(j)} className="rounded-xl border bg-card p-3 hover:shadow cursor-pointer">
                      <div className="text-sm font-medium leading-tight line-clamp-2">{j.title}</div>
                      <div className="text-xs text-muted-foreground">{j.company}</div>
                      <div className="mt-2 flex items-center justify-between"><Badge variant="secondary">{j.matchScore ?? j.match_score ?? 0}%</Badge><span className="text-xs text-muted-foreground">{(j.location ?? '').slice(0,16)}</span></div>
                    </div>
                  ))}
                  {col.length===0 && <div className="text-xs text-muted-foreground text-center py-8 border border-dashed rounded-xl">Empty</div>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={()=>setSelected(null)}/>
          <div className="ml-auto w-full max-w-xl bg-card border-l shadow-2xl overflow-auto">
            <div className="sticky top-0 bg-card border-b p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold leading-tight">{selected.title}</h3>
                  <p className="text-sm text-muted-foreground">{selected.company} • {selected.location}</p>
                  <a href={selected.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 mt-1">View original <ExternalLink className="h-3 w-3"/></a>
                </div>
                <Button variant="ghost" size="sm" onClick={()=>setSelected(null)}>Close</Button>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <ScoreRing score={selected.matchScore ?? selected.match_score ?? 0}/>
                <Badge>{selected.status}</Badge>
                <span className="text-xs text-muted-foreground">{selected.matchingVersion ?? selected.matching_version ?? 'ext-v1'}</span>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">Matched skills</h4>
                <div className="flex flex-wrap gap-2">
                  {(selected.matchedSkills ?? selected.matched_skills ?? []).map((s:any,i:number)=>(
                    <span key={i} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${s.matched ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground'}`}>
                      {s.skill_name ?? s.skillName} {s.matched_in_title ? '• title' : ''}
                    </span>
                  ))}
                  {(selected.matchedSkills ?? selected.matched_skills ?? []).length===0 && <span className="text-xs text-muted-foreground">No skill breakdown stored</span>}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">Description</h4>
                <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap border rounded-xl p-4 bg-muted/30 max-h-[320px] overflow-auto">{selected.description}</div>
              </div>
              <div className="flex gap-2">
                <Select value={selected.status} onChange={e=> updateStatus(selected.id, e.target.value)}>
                  {statuses.filter(Boolean).map(s=> <option key={s} value={s}>{s}</option>)}
                </Select>
                <Button variant="outline" onClick={async()=>{ await api.rematchJob(selected.id); const r=await api.getJob(selected.id); setSelected(r.data)}}>Rematch</Button>
                <Button variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={()=>deleteJob(selected)}>Delete</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v)=>!v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400"/>
              </div>
              Delete this job?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">"{deleteTarget?.title}"</span>{' '}
              from <span className="font-medium text-foreground">{deleteTarget?.company || '—'}</span> will be permanently removed.
              Its notifications are also deleted — if you re-scrape the same listing it will be treated as a new job and re-notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={()=>setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  async function updateStatus(id: string, status: string) {
    await api.updateJobStatus(id, { status })
    setSelected((prev:any)=> prev ? { ...prev, status } : prev)
    load(page)
  }
}
