import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { Plus, Trash2, Edit3, Sparkles } from 'lucide-react'

type SkillType = 'required'|'preferred'|'excluded'

export default function Skills() {
  const [skills, setSkills] = useState<any[]>([])
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any|null>(null)
  const [form, setForm] = useState({ skill_name:'', weight: 10, skill_type:'preferred' as SkillType, aliases: '' })
  const [previewTitle, setPreviewTitle] = useState('Senior Laravel Developer')
  const [previewDesc, setPreviewDesc] = useState('We need Laravel, PHP, MySQL, Docker, Redis. Excluding WordPress.')
  const [previewRes, setPreviewRes] = useState<any|null>(null)

  async function load(){
    const r=await api.getSkills(filter ? { search: filter } : undefined)
    setSkills(r.data)
  }
  useEffect(()=>{ load() },[filter])

  async function submit(){
    const payload:any = { skill_name: form.skill_name, weight: Number(form.weight), skill_type: form.skill_type }
    // Backend expects aliases as string[] (see skills.validators.ts). Always send an array (empty = clear).
    payload.aliases = form.aliases.split(',').map(s=>s.trim()).filter(Boolean)
    try {
      if (editing) await api.updateSkill(editing.id, payload)
      else await api.createSkill(payload)
      setOpen(false); setEditing(null); setForm({ skill_name:'', weight:10, skill_type:'preferred', aliases:'' }); await load()
    } catch (e:any) {
      alert(e?.body?.message || e?.message || 'Failed to save skill')
    }
  }
  async function del(id:string){
    if(!confirm('Delete skill?'))return;
    try { await api.deleteSkill(id); await load() } catch (e:any) { alert(e?.body?.message || e?.message || 'Failed to delete skill') }
  }

  async function runPreview(){
    const r=await api.previewMatch({ title: previewTitle, description: previewDesc })
    setPreviewRes(r.data)
  }
  useEffect(()=>{ runPreview() },[])

  const totalWeight = skills.reduce((a,s)=>a+(s.weight??0),0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex-1 flex gap-2">
          <Input placeholder="Search skills…" value={filter} onChange={e=>setFilter(e.target.value)} className="max-w-sm"/>
          <Button variant="outline" onClick={load}>Search</Button>
        </div>
        <Button onClick={()=>{ setEditing(null); setForm({ skill_name:'', weight:10, skill_type:'preferred', aliases:'' }); setOpen(true)}}><Plus className="h-4 w-4"/> Add skill</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {skills.map(s=>{
          const aliases = s.aliases ?? []
          return (
            <Card key={s.id} className="hover:shadow-md transition">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold flex items-center gap-2">{s.skill_name ?? s.skillName} <Badge variant={s.skill_type==='required'?'danger': s.skill_type==='excluded'?'warning':'success'} className="capitalize text-[11px]">{s.skill_type ?? s.skillType}</Badge></div>
                    <div className="text-xs text-muted-foreground">normalized: {s.normalized_name ?? s.normalizedName} • weight {s.weight} / {totalWeight}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>{ setEditing(s); setForm({ skill_name: s.skill_name ?? s.skillName, weight: s.weight, skill_type: s.skill_type ?? s.skillType, aliases: (aliases.map((a:any)=>a.alias).join(', ')) }); setOpen(true)}}><Edit3 className="h-3.5 w-3.5"/></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={()=>del(s.id)}><Trash2 className="h-3.5 w-3.5"/></Button>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-violet-600 to-indigo-600" style={{ width: `${Math.min(100, (s.weight/totalWeight)*100*3)}%`}}/></div>
                </div>
                {aliases.length>0 && <div className="flex flex-wrap gap-1.5 mt-3">{aliases.map((a:any,i:number)=><span key={i} className="text-xs bg-muted px-2 py-1 rounded-full">{a.alias}</span>)}</div>}
              </CardContent>
            </Card>
          )
        })}
      </div>
      {skills.length===0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No skills — add your stack to power matching</CardContent></Card>}

      <Card className="border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600"/> Live match preview</CardTitle>
          <CardDescription>Same formula as extension: <code className="bg-white/60 dark:bg-black/20 px-1 rounded">Σ matched weights / Σ all scoring weights ×100</code></CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-2"><Label>Job title</Label><Input value={previewTitle} onChange={e=>setPreviewTitle(e.target.value)} /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={previewDesc} onChange={e=>setPreviewDesc(e.target.value)} rows={4}/></div>
            <Button onClick={runPreview} className="w-full">Calculate match</Button>
          </div>
          <div className="rounded-2xl bg-card border p-5 flex flex-col items-center justify-center text-center">
            {previewRes ? (
              <>
                <div className={`h-28 w-28 rounded-full border-[6px] flex items-center justify-center text-3xl font-extrabold ${previewRes.result.isDisqualified ? 'border-red-500 text-red-600' : previewRes.eligible ? 'border-emerald-500 text-emerald-600' : 'border-amber-500 text-amber-600'}`} style={{ background: `conic-gradient(hsl(var(--primary)) ${previewRes.result.score}%, transparent 0)` }}>
                  <span className="bg-card rounded-full h-20 w-20 flex items-center justify-center">{previewRes.result.score}%</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Badge variant={previewRes.eligible ? 'success':'warning'}>{previewRes.eligible ? 'Eligible • would notify' : previewRes.result.isDisqualified ? 'Disqualified' : `Below ${previewRes.threshold}%`}</Badge>
                  {previewRes.result.isDisqualified && <Badge variant="danger">excluded hit</Badge>}
                </div>
                <div className="mt-4 w-full text-left space-y-1">
                  {previewRes.result.matchedSkills?.map((m:any,i:number)=>(
                    <div key={i} className="flex items-center justify-between text-xs border rounded-lg px-3 py-2 bg-muted/30">
                      <span className="font-medium">{m.skill_name} <span className="text-muted-foreground">({m.type} • {m.weight})</span></span>
                      <span className={m.matched ? 'text-emerald-600 font-semibold':'text-muted-foreground'}>{m.matched ? '✓ matched' : '—'} {m.matched_in_title ? '• title' : ''}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <div className="text-sm text-muted-foreground">Run preview to see score</div>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={()=>setOpen(false)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit skill':'Add skill'}</DialogTitle>
            <DialogDescription>Weight = importance • Type defines required/preferred/excluded behavior</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Skill name</Label><Input value={form.skill_name} onChange={e=>setForm({...form, skill_name:e.target.value})} placeholder="Laravel"/></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Type</Label>
                <select value={form.skill_type} onChange={e=>setForm({...form, skill_type:e.target.value as any})} className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
                  <option value="required">required</option><option value="preferred">preferred</option><option value="excluded">excluded</option>
                </select>
              </div>
              <div className="space-y-2"><Label>Weight (1-100)</Label><Input type="number" min={1} max={100} value={form.weight} onChange={e=>setForm({...form, weight: Number(e.target.value)})}/></div>
            </div>
            <div className="space-y-2"><Label>Aliases (comma separated)</Label><Input value={form.aliases} onChange={e=>setForm({...form, aliases:e.target.value})} placeholder="postgres, psql"/></div>
            <div className="pt-2"><Label>Weight preview</Label><Slider value={form.weight} min={1} max={100} onValueChange={v=>setForm({...form, weight:v})}/><div className="text-xs text-muted-foreground text-right">{form.weight}</div></div>
            <Button onClick={submit} className="w-full">{editing ? 'Save':'Create'} skill</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
