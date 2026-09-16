import { useEffect, useState, KeyboardEvent } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Plus, Trash2, Power, Clock, Edit3, X, Search } from 'lucide-react'

type SourceType = 'linkedin' | 'indeed' | 'bdjobs' | 'nextjobzbd' | 'custom_board'

interface SourceForm {
  name: string
  source_type: SourceType
  base_url: string
  scraper_version: string
  schedule: string
  keywords: string[]
  keywordInput: string
  maxJobsPerKeyword: number
  searchUrl: string
  maxPages: number
  location: string
  rawConfig: string
}

const DEFAULT_FORM: SourceForm = {
  name: '',
  source_type: 'linkedin',
  base_url: 'https://www.linkedin.com',
  scraper_version: '1.0.0',
  schedule: '0 */6 * * *',
  keywords: [],
  keywordInput: '',
  maxJobsPerKeyword: 25,
  searchUrl: 'https://www.indeed.com/jobs?q=Software+Engineer&l=',
  maxPages: 3,
  location: '',
  rawConfig: '{}',
}

function buildScraperConfig(form: SourceForm): Record<string, unknown> {
  if (form.source_type === 'linkedin') {
    return {
      keywords: form.keywords,
      maxJobsPerKeyword: form.maxJobsPerKeyword,
    }
  }
  if (form.source_type === 'bdjobs') {
    return {
      keywords: form.keywords,
      ...(form.location.trim() ? { location: form.location.trim() } : {}),
      ...(form.maxPages ? { maxPages: form.maxPages } : {}),
    }
  }
  if (form.source_type === 'nextjobzbd') {
    return {
      keywords: form.keywords,
      ...(form.maxPages ? { maxPages: form.maxPages } : {}),
    }
  }
  if (form.source_type === 'indeed') {
    return {
      searchUrl: form.searchUrl.trim(),
      ...(form.maxPages ? { maxPages: form.maxPages } : {}),
    }
  }
  try {
    return JSON.parse(form.rawConfig || '{}')
  } catch {
    return {}
  }
}

function parseSourceToForm(s: any): SourceForm {
  const cfg = s.scraper_config ?? s.scraperConfig ?? {}
  if (s.source_type === 'linkedin' || s.sourceType === 'linkedin') {
    return {
      name: s.name ?? '',
      source_type: 'linkedin',
      base_url: s.base_url ?? s.baseUrl ?? 'https://www.linkedin.com',
      scraper_version: s.scraper_version ?? s.scraperVersion ?? '1.0.0',
      schedule: s.schedule ?? '0 */6 * * *',
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords : [],
      keywordInput: '',
      maxJobsPerKeyword: cfg.maxJobsPerKeyword ?? 25,
      searchUrl: 'https://www.indeed.com/jobs?q=Software+Engineer&l=',
      maxPages: 3,
      location: cfg.location ?? '',
      rawConfig: JSON.stringify(cfg, null, 2),
    }
  }
  if (s.source_type === 'bdjobs' || s.sourceType === 'bdjobs') {
    return {
      name: s.name ?? '',
      source_type: 'bdjobs',
      base_url: s.base_url ?? s.baseUrl ?? 'https://www.bdjobs.com',
      scraper_version: s.scraper_version ?? s.scraperVersion ?? '1.0.0',
      schedule: s.schedule ?? '0 */6 * * *',
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords : [],
      keywordInput: '',
      maxJobsPerKeyword: 25,
      searchUrl: '',
      maxPages: cfg.maxPages ?? 3,
      location: cfg.location ?? '',
      rawConfig: JSON.stringify(cfg, null, 2),
    }
  }
  if (s.source_type === 'indeed' || s.sourceType === 'indeed') {
    return {
      name: s.name ?? '',
      source_type: 'indeed',
      base_url: s.base_url ?? s.baseUrl ?? 'https://www.indeed.com',
      scraper_version: s.scraper_version ?? s.scraperVersion ?? '1.0.0',
      schedule: s.schedule ?? '0 */6 * * *',
      keywords: [],
      keywordInput: '',
      maxJobsPerKeyword: 25,
      searchUrl: cfg.searchUrl ?? 'https://www.indeed.com/jobs?q=Software+Engineer&l=',
      maxPages: cfg.maxPages ?? 3,
      location: cfg.location ?? '',
      rawConfig: JSON.stringify(cfg, null, 2),
    }
  }
  if (s.source_type === 'nextjobzbd' || s.sourceType === 'nextjobzbd') {
    return {
      name: s.name ?? '',
      source_type: 'nextjobzbd',
      base_url: s.base_url ?? s.baseUrl ?? 'https://nextjobz.com.bd',
      scraper_version: s.scraper_version ?? s.scraperVersion ?? '1.0.0',
      schedule: s.schedule ?? '0 */6 * * *',
      keywords: Array.isArray(cfg.keywords) ? cfg.keywords : [],
      keywordInput: '',
      maxJobsPerKeyword: 25,
      searchUrl: '',
      maxPages: cfg.maxPages ?? 10,
      location: '',
      rawConfig: JSON.stringify(cfg, null, 2),
    }
  }
  return {
    name: s.name ?? '',
    source_type: (s.source_type ?? s.sourceType ?? 'custom_board') as SourceType,
    base_url: s.base_url ?? s.baseUrl ?? '',
    scraper_version: s.scraper_version ?? s.scraperVersion ?? '1.0.0',
    schedule: s.schedule ?? '0 */6 * * *',
    keywords: [],
    keywordInput: '',
    maxJobsPerKeyword: 25,
    searchUrl: '',
    maxPages: 3,
    location: '',
    rawConfig: JSON.stringify(cfg, null, 2),
  }
}

export default function Sources() {
  const [sources, setSources] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState<SourceForm>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const r = await api.getSources()
    setSources(r.data)
  }
  useEffect(() => {
    load()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(DEFAULT_FORM)
    setError('')
    setOpen(true)
  }

  function openEdit(s: any) {
    setEditing(s)
    setForm(parseSourceToForm(s))
    setError('')
    setOpen(true)
  }

  function addKeyword() {
    const v = form.keywordInput.trim()
    if (!v) return
    // allow comma-separated paste
    const parts = v.split(',').map(p => p.trim()).filter(Boolean)
    const next = [...form.keywords]
    for (const p of parts) {
      if (!next.some(k => k.toLowerCase() === p.toLowerCase())) next.push(p)
    }
    setForm({ ...form, keywords: next, keywordInput: '' })
  }

  function onKeywordKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeyword()
    }
    if (e.key === 'Backspace' && !form.keywordInput && form.keywords.length > 0) {
      setForm({ ...form, keywords: form.keywords.slice(0, -1) })
    }
  }

  function removeKeyword(idx: number) {
    setForm({ ...form, keywords: form.keywords.filter((_, i) => i !== idx) })
  }

  async function submit() {
    setError('')
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
                    if ((form.source_type === 'linkedin' || form.source_type === 'bdjobs') && form.keywords.length === 0) {
      setError('Add at least one keyword — e.g. Software Engineer')
      return
    }
    if (form.source_type === 'nextjobzbd' && form.keywords.length === 0) {
      setError('Add at least one keyword — e.g. Laravel Developer')
      return
    }
    if (form.source_type === 'indeed' && !form.searchUrl.trim().startsWith('https://')) {
      setError('Indeed searchUrl must start with https://')
      return
    }

    const scraper_config = buildScraperConfig(form)
    const payload: any = {
      name: form.name.trim(),
      source_type: form.source_type,
      base_url: form.base_url.trim(),
      scraper_version: form.scraper_version.trim(),
      schedule: form.schedule.trim(),
      scraper_config,
    }

    setSaving(true)
    try {
      if (editing) {
        await api.updateSource(editing.id, payload)
      } else {
        await api.createSource(payload)
      }
      setOpen(false)
      setEditing(null)
      setForm(DEFAULT_FORM)
      await load()
    } catch (e: any) {
      setError(e?.body?.message || e?.body?.details ? JSON.stringify(e.body.details) : e?.message || 'Failed to save source. Check validation.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(s: any) {
    try {
      await api.updateSource(s.id, { is_enabled: !(s.is_enabled ?? s.isEnabled) })
      await load()
    } catch (e: any) {
      alert(e?.body?.message || e?.message || 'Failed to toggle')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete source? Keywords and schedule will be removed. Extension will stop scraping this source.')) return
    try {
      await api.deleteSource(id)
      await load()
    } catch (e: any) {
      alert(e?.body?.message || e?.message || 'Failed to delete')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Extension fetches these via <code className="bg-muted px-1.5 py-0.5 rounded text-xs">GET /api/sources</code> • scopes:{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">sources:read</code>
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Keywords are dynamic — edit here, extension picks them up on next sync (no file edit, no redeploy).
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add source
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((s) => {
          const enabled = s.is_enabled ?? s.isEnabled
          const cfg = s.scraper_config ?? s.scraperConfig ?? {}
          const keywords: string[] = Array.isArray(cfg.keywords) ? cfg.keywords : []
          const searchUrl: string | undefined = cfg.searchUrl
          return (
            <Card key={s.id} className={`overflow-hidden ${enabled ? 'border-violet-200 dark:border-violet-900' : 'opacity-70'}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 text-base truncate">
                      {s.name} <Badge variant="outline" className="capitalize shrink-0">{s.source_type ?? s.sourceType}</Badge>
                    </CardTitle>
                    <CardDescription className="truncate max-w-[220px]">{s.base_url ?? s.baseUrl}</CardDescription>
                  </div>
                  <Badge variant={enabled ? 'success' : 'secondary'} className="shrink-0">{enabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {s.schedule} • v{s.scraper_version ?? s.scraperVersion} • cfg v{s.config_version ?? s.configVersion}
                </div>

                {/* Dynamic keywords display */}
                {keywords.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Keywords ({keywords.length}) — extension searches these:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {keywords.map((k: string, i: number) => (
                        <span key={i} className="inline-flex items-center gap-1 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 px-2.5 py-1 rounded-full text-xs font-medium">
                          <Search className="h-3 w-3" />
                          {k}
                        </span>
                      ))}
                    </div>
                    {cfg.maxJobsPerKeyword && <div className="text-xs text-muted-foreground">max {cfg.maxJobsPerKeyword} jobs per keyword</div>}
                  </div>
                ) : searchUrl ? (
                  <div className="rounded-xl bg-muted/50 p-2.5 text-xs font-mono truncate" title={searchUrl}>
                    {searchUrl.slice(0, 80)}
                  </div>
                ) : (
                  <div className="rounded-xl bg-muted/50 p-2.5 text-xs font-mono truncate">{JSON.stringify(cfg).slice(0, 120) || '{}'}</div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(s)}>
                    <Edit3 className="h-3.5 w-3.5" /> Edit keywords
                  </Button>
                  <Button variant={enabled ? 'secondary' : 'default'} size="sm" onClick={() => toggle(s)} title={enabled ? 'Disable' : 'Enable'}>
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
      {sources.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">No sources yet — add LinkedIn, bdjobs, or NextJobzBD to start scraping</CardContent></Card>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit source & keywords' : 'Add source with keywords'}</DialogTitle>
            <DialogDescription>
              Backend is source of truth — extension fetches keywords via <code className="bg-muted px-1 rounded">GET /api/sources</code> on each run. No file edit needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LinkedIn — Software Engineer roles" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <select
                  value={form.source_type}
                  onChange={(e) => {
                   const next = e.target.value as SourceType
                   const base = next === 'bdjobs' ? 'https://www.bdjobs.com' : next === 'linkedin' ? 'https://www.linkedin.com' : next === 'indeed' ? 'https://www.indeed.com' : next === 'nextjobzbd' ? 'https://nextjobz.com.bd' : form.base_url
                   const shouldSwap = ['https://www.linkedin.com', 'https://www.bdjobs.com', 'https://www.indeed.com', 'https://nextjobz.com.bd'].includes(form.base_url)
                    setForm({ ...form, source_type: next, base_url: shouldSwap ? base : form.base_url })
                  }}
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="linkedin">linkedin</option>
                  <option value="bdjobs">bdjobs</option>
                  <option value="indeed">indeed</option>
                  <option value="nextjobzbd">nextjobzbd</option>
                  <option value="custom_board">custom_board</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Schedule (cron)</Label>
                <Input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="0 */6 * * *" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://www.linkedin.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Scraper version</Label>
                <Input value={form.scraper_version} onChange={(e) => setForm({ ...form, scraper_version: e.target.value })} />
              </div>
              {form.source_type === 'linkedin' && (
                <div className="space-y-2">
                  <Label>Max jobs / keyword</Label>
                  <Input type="number" min={1} max={100} value={form.maxJobsPerKeyword} onChange={(e) => setForm({ ...form, maxJobsPerKeyword: Number(e.target.value) || 25 })} />
                </div>
              )}
              {form.source_type === 'bdjobs' && (
                <div className="space-y-2">
                  <Label>Max pages</Label>
                  <Input type="number" min={1} max={20} value={form.maxPages} onChange={(e) => setForm({ ...form, maxPages: Number(e.target.value) || 3 })} />
                </div>
              )}
              {form.source_type === 'indeed' && (
                <div className="space-y-2">
                  <Label>Max pages</Label>
                  <Input type="number" min={1} max={20} value={form.maxPages} onChange={(e) => setForm({ ...form, maxPages: Number(e.target.value) || 3 })} />
                </div>
              )}
            </div>

            {(form.source_type === 'linkedin' || form.source_type === 'bdjobs' || form.source_type === 'nextjobzbd') && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5" /> Keywords — press Enter or comma to add
                </Label>
                <div className="min-h-11 w-full rounded-xl border border-input bg-background px-2 py-2 flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-ring">
                  {form.keywords.map((k, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-violet-600 text-white px-2.5 py-1 rounded-full text-xs font-medium">
                      {k}
                      <button type="button" onClick={() => removeKeyword(i)} className="hover:bg-white/20 rounded-full p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    className="flex-1 min-w-[120px] bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    value={form.keywordInput}
                    onChange={(e) => setForm({ ...form, keywordInput: e.target.value })}
                    onKeyDown={onKeywordKeyDown}
                    onBlur={addKeyword}
                    placeholder={form.keywords.length === 0 ? 'Software Engineer, Backend Developer...' : 'Add more...'}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Example: <code className="bg-muted px-1 rounded">Software Engineer</code>{' '}
                  <code className="bg-muted px-1 rounded">Node.js Developer</code> — extension builds{' '}
                  <code className="bg-muted px-1 rounded">
                    {form.source_type === 'bdjobs'
                      ? 'https://www.bdjobs.com/jobs/search-jobs?keywords=...'
                      : form.source_type === 'nextjobzbd'
                      ? 'https://nextjobz.com.bd/jobs?q=...'
                      : 'https://www.linkedin.com/jobs/search?keywords=...'}
                  </code>{' '}
                  per keyword.
                </p>
              </div>
            )}

            {form.source_type === 'bdjobs' && (
              <div className="space-y-2">
                <Label>Location (optional)</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Dhaka, Chittagong — leave empty for all" />
                <p className="text-xs text-muted-foreground">Filter by bdjobs location. Leave empty to search all locations.</p>
              </div>
            )}

            {form.source_type === 'nextjobzbd' && (
              <div className="space-y-2">
                <Label>Max pages</Label>
                <Input type="number" min={1} max={20} value={form.maxPages} onChange={(e) => setForm({ ...form, maxPages: Number(e.target.value) || 10 })} />
                <p className="text-xs text-muted-foreground">Maximum pages to scrape per keyword (default 10).</p>
              </div>
            )}

            {form.source_type === 'indeed' && (
              <div className="space-y-2">
                <Label>Indeed Search URL</Label>
                <Input value={form.searchUrl} onChange={(e) => setForm({ ...form, searchUrl: e.target.value })} placeholder="https://www.indeed.com/jobs?q=Software+Engineer&l=" />
                <p className="text-xs text-muted-foreground">Full search URL with query params. Extension scrapes this page.</p>
              </div>
            )}

            {form.source_type === 'custom_board' && (
              <div className="space-y-2">
                <Label>Config JSON (advanced)</Label>
                <textarea
                  value={form.rawConfig}
                  onChange={(e) => setForm({ ...form, rawConfig: e.target.value })}
                  rows={4}
                  className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-mono"
                  placeholder='{"keywords":["Software Engineer"]}'
                />
              </div>
            )}

            {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

            <Button onClick={submit} className="w-full" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save keywords' : 'Create source'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">Extension `GET /api/sources` → reads `scraper_config.keywords` → searches each keyword sequentially.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
