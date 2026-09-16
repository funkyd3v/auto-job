import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { KeyRound, Copy, Check, Shield, Bell, Send, Unplug, Clock, Plus, Trash2, Play } from 'lucide-react'

export default function Settings() {
  const [tab, setTab] = useState('matching')
  const [threshold, setThreshold] = useState(70)
  const [notify, setNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [keys, setKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<any|null>(null)
  const [copied, setCopied] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [keyName, setKeyName] = useState('Extension API Key')
  const [scopes, setScopes] = useState('jobs:write,sources:read,scrape-runs:write')
  const [tgStatus, setTgStatus] = useState<any>(null)
  const [botToken, setBotToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [tgBusy, setTgBusy] = useState(false)
  const [tgMsg, setTgMsg] = useState<{ ok: boolean; text: string } | null>(null)
  
  // Scheduler state
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([])
  const [nextRuns, setNextRuns] = useState<string[]>([])
  const [newTime, setNewTime] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function loadTelegram(){
    const s = await api.getTelegramStatus().catch(() => null)
    if (s?.data) setTgStatus(s.data)
  }

  async function loadSchedule(){
    try {
      const s = await api.getScheduleConfig()
      console.log('[loadSchedule] response:', JSON.stringify(s))
      if (s?.data) {
        console.log('[loadSchedule] setting state:', s.data.enabled, s.data.times, s.data.nextRuns)
        setScheduleEnabled(s.data.enabled)
        setScheduleTimes(s.data.times)
        setNextRuns(s.data.nextRuns)
      }
    } catch (e) {
      console.error('[loadSchedule] error:', e)
    }
  }

  async function load(){
    try { const s=await api.getMatchSettings(); setThreshold(s.data.min_match_percentage); setNotify(s.data.notify_on_match) } catch {}
    try { const k=await api.getApiKeys().catch(()=>({keys:[]}) as any); setKeys(k.keys ?? []) } catch {}
    await loadTelegram()
    await loadSchedule()
  }
  useEffect(()=>{ load() },[])

  async function connectTg(){
    setTgBusy(true); setTgMsg(null)
    try {
      await api.telegramConnect({ botToken: botToken, chatId: telegramChatId })
      setTgMsg({ ok: true, text: 'Connected. Matched jobs will be sent to this chat.' })
      setBotToken(''); setTelegramChatId('')
      await loadTelegram()
    } catch (e:any) {
      setTgMsg({ ok: false, text: String(e?.message || e || 'Failed to connect') })
    } finally { setTgBusy(false) }
  }

  async function verifyTg(){
    setTgBusy(true); setTgMsg(null)
    try {
      await api.telegramVerify({ botToken: botToken, chatId: telegramChatId })
      setTgMsg({ ok: true, text: 'Test message sent to Telegram.' })
    } catch (e:any) {
      setTgMsg({ ok: false, text: String(e?.message || e || 'Failed to send test') })
    } finally { setTgBusy(false) }
  }

  async function disconnectTg(){
    setTgBusy(true); setTgMsg(null)
    try {
      await api.telegramDisconnect()
      setTgMsg({ ok: true, text: 'Disconnected.' })
      await loadTelegram()
    } catch (e:any) {
      setTgMsg({ ok: false, text: String(e?.message || e || 'Failed to disconnect') })
    } finally { setTgBusy(false) }
  }

  async function save(){
    setSaving(true)
    try { await api.updateMatchSettings({ min_match_percentage: threshold, notify_on_match: notify }); } finally { setSaving(false) }
  }

  // Scheduler functions
  function to12Hour(time24h: string): string {
    const [h, m] = time24h.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`
  }

  function to24Hour(time12h: string): string {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
    if (!match) return time12h
    let h = parseInt(match[1], 10)
    const m = match[2]
    const period = match[3].toUpperCase()
    if (period === 'AM' && h === 12) h = 0
    if (period === 'PM' && h !== 12) h += 12
    return `${h.toString().padStart(2, '0')}:${m}`
  }

  function addTime(){
    if (!newTime) return
    const time24 = to24Hour(newTime)
    if (scheduleTimes.includes(time24)) {
      setScheduleMsg({ ok: false, text: 'This time is already added.' })
      return
    }
    setScheduleTimes([...scheduleTimes, time24].sort())
    setNewTime('')
    setScheduleMsg(null)
  }

  function removeTime(time: string){
    setScheduleTimes(scheduleTimes.filter(t => t !== time))
  }

  async function saveSchedule(){
    setScheduleSaving(true)
    setScheduleMsg(null)
    try {
      const result = await api.updateScheduleConfig({
        schedule_enabled: scheduleEnabled,
        schedule_times: scheduleTimes,
      })
      console.log('[saveSchedule] result:', JSON.stringify(result))
      setScheduleEnabled(result.data.enabled)
      setScheduleTimes(result.data.times)
      setNextRuns(result.data.nextRuns)
      setScheduleMsg({ ok: true, text: `Schedule saved. ${result.data.jobsCreated} job(s) scheduled.` })
      await loadSchedule()
    } catch (e: any) {
      setScheduleMsg({ ok: false, text: String(e?.message || e || 'Failed to save schedule') })
    } finally {
      setScheduleSaving(false)
    }
  }

  async function triggerNow(){
    setScheduleSaving(true)
    setScheduleMsg(null)
    try {
      const result = await api.triggerScheduleNow()
      setScheduleMsg({ ok: true, text: `Triggered! ${result.data.jobsQueued} scrape job(s) queued.` })
    } catch (e: any) {
      setScheduleMsg({ ok: false, text: String(e?.message || e || 'Failed to trigger') })
    } finally {
      setScheduleSaving(false)
    }
  }

  async function createKey(){
    const r=await api.createApiKey({ name: keyName, scopes: scopes.split(',').map(s=>s.trim()).filter(Boolean) })
    setNewKey(r.key); setCreateOpen(false); load()
  }

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="matching">Matching</TabsTrigger>
          <TabsTrigger value="scheduler">Scheduler</TabsTrigger>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
        </TabsList>

        <TabsContent value="matching">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-violet-200 dark:border-violet-900/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-violet-600"/> Match threshold</CardTitle>
                <CardDescription>Extension fetches <code className="bg-muted px-1 rounded">GET /api/settings/match</code> before each scrape. Only jobs ≥ threshold are submitted.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white p-6 text-center">
                  <div className="text-5xl font-extrabold">{threshold}%</div>
                  <div className="text-sm text-white/80">Minimum match to notify</div>
                </div>
                <div>
                  <Slider value={threshold} min={0} max={100} onValueChange={setThreshold} />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>0% — lenient</span><span>100% — strict</span></div>
                </div>
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <div className="text-sm font-medium">Notify on match</div>
                    <div className="text-xs text-muted-foreground">Send Telegram when eligible &amp; not yet notified</div>
                  </div>
                  <Switch checked={notify} onCheckedChange={setNotify} />
                </div>
                <Button onClick={save} disabled={saving} className="w-full">{saving ? 'Saving…':'Save settings'}</Button>
                <p className="text-xs text-muted-foreground">Formula: <code>(Σ matched weights / Σ scoring weights) ×100</code> • Title matches weighted higher • <Badge variant="outline" className="ml-1">ext-v1</Badge></p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How it works</CardTitle>
                <CardDescription>Phase 7 local matching flow</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-relaxed">
                <div className="rounded-xl bg-muted/50 p-4 font-mono text-xs">
                  Extension → GET /api/skills<br/>
                  Extension → GET /api/settings/match<br/>
                  Extension → scrape → normalize → match locally<br/>
                  if score ≥ {threshold}% → POST /api/jobs/ingest<br/>
                  Backend → dedup → persist score → UNIQUE(job,channel,type) → Telegram
                </div>
                <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                  <li><b>required</b> missing → score 0 / disqualify</li>
                  <li><b>excluded</b> present → disqualify</li>
                  <li><b>preferred</b> contributes by weight</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="scheduler">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-violet-200 dark:border-violet-900/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4 text-violet-600"/> Automatic Scheduler</CardTitle>
                <CardDescription>Set exact times (GMT+6 Asia/Dhaka) to run scrapers automatically. All enabled sources will be scraped at each scheduled time.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <div className="text-sm font-medium">Enable scheduler</div>
                    <div className="text-xs text-muted-foreground">Automatically scrape at scheduled times</div>
                  </div>
                  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
                </div>

                <div className="space-y-2">
                  <Label>Add time (12-hour format)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={addTime} disabled={!newTime} variant="outline">
                      <Plus className="h-4 w-4"/>
                    </Button>
                  </div>
                </div>

                {scheduleTimes.length > 0 && (
                  <div className="space-y-2">
                    <Label>Scheduled times</Label>
                    <div className="flex flex-wrap gap-2">
                      {scheduleTimes.map((time) => (
                        <Badge key={time} variant="secondary" className="flex items-center gap-1 pr-1">
                          {to12Hour(time)}
                          <button
                            onClick={() => removeTime(time)}
                            className="ml-1 rounded-full p-0.5 hover:bg-muted"
                          >
                            <Trash2 className="h-3 w-3"/>
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {scheduleMsg && (
                  <div className={`rounded-xl border px-4 py-2 text-sm ${scheduleMsg.ok ? 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' : 'border-red-500/30 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400'}`}>
                    {scheduleMsg.text}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={saveSchedule} disabled={scheduleSaving} className="flex-1">
                    {scheduleSaving ? 'Saving…' : 'Save schedule'}
                  </Button>
                  <Button onClick={triggerNow} disabled={scheduleSaving} variant="outline">
                    <Play className="h-4 w-4"/> Run now
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Timezone: <Badge variant="outline">GMT+6 Asia/Dhaka</Badge> • 
                  All enabled sources will be scraped at each time
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming Runs</CardTitle>
                <CardDescription>Next scheduled scrape times</CardDescription>
              </CardHeader>
              <CardContent>
                {nextRuns.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-xl">
                    {scheduleEnabled ? 'Add times to see upcoming runs' : 'Scheduler is disabled'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {nextRuns.map((run, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-xl border p-3 text-sm">
                        <Clock className="h-4 w-4 text-violet-600"/>
                        {run}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm">
                  <div className="font-medium mb-2">How it works</div>
                  <ul className="list-disc pl-5 text-muted-foreground space-y-1 text-xs">
                    <li>Each time creates a BullMQ repeatable job</li>
                    <li>Worker picks up jobs and runs Python scrapers</li>
                    <li>Jobs are matched against your skills</li>
                    <li>Qualifying jobs trigger Telegram notification</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="api">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4"/> API keys</CardTitle>
                <CardDescription>Extension uses <code>X-Api-Key</code> • hashed with SHA-256 • show once</CardDescription>
              </div>
              <Button onClick={()=>setCreateOpen(true)}>Generate token</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {newKey && (
                <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 p-4">
                  <div className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4"/> Store this key securely — shown once</div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 rounded-lg bg-card border px-3 py-2 text-sm font-mono break-all">{newKey.key ?? newKey.apiKey ?? JSON.stringify(newKey)}</code>
                    <Button size="icon" variant="outline" onClick={async()=>{ await navigator.clipboard.writeText(newKey.key ?? newKey.apiKey ?? ''); setCopied(true); setTimeout(()=>setCopied(false),1500)}}>{copied ? <Check className="h-4 w-4"/> : <Copy className="h-4 w-4"/>}</Button>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Prefix: {newKey.keyPrefix ?? newKey.key_prefix} • Scopes: {(newKey.scopes ?? []).join(', ')}</div>
                </div>
              )}
              <div className="space-y-2">
                {keys.map((k:any)=>(
                  <div key={k.id} className="flex items-center justify-between rounded-xl border p-3">
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">{k.name} <Badge variant="outline" className="font-mono text-xs">{k.keyPrefix ?? k.key_prefix}••••</Badge></div>
                      <div className="text-xs text-muted-foreground">scopes: {(k.scopes ?? []).join(', ')} • {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt ?? k.last_used_at).toLocaleString()}` : 'never used'}</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={async()=>{ if(!confirm('Revoke key?'))return; await api.revokeApiKey(k.id); load()}}>Revoke</Button>
                  </div>
                ))}
                {keys.length===0 && <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-xl">No keys — generate one for the Chrome extension</div>}
              </div>
            </CardContent>
          </Card>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent onClose={()=>setCreateOpen(false)}>
              <DialogHeader>
                <DialogTitle>Generate API token</DialogTitle>
                <DialogDescription>Extension needs <code>jobs:write, sources:read, scrape-runs:write</code></DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label>Name</Label><Input value={keyName} onChange={e=>setKeyName(e.target.value)} /></div>
                <div className="space-y-2"><Label>Scopes (comma separated)</Label><Input value={scopes} onChange={e=>setScopes(e.target.value)} /></div>
                <Button onClick={createKey} className="w-full">Generate</Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="telegram">
          <Card>
            <CardHeader>
              <CardTitle>Telegram</CardTitle>
              <CardDescription>Connect a bot so matched jobs get delivered — deduped by <code>UNIQUE(job_id, channel, type)</code></CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {tgStatus?.connected ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 p-4 text-sm">
                  <div className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-emerald-600"/> Connected as <code>@{tgStatus.botUsername}</code></div>
                  <div className="text-muted-foreground mt-1">Delivering to chat <code>{tgStatus.chatId}</code> • notify on match: {tgStatus.notifyOnMatch ? 'on' : 'off'}</div>
                </div>
              ) : (
                <div className="rounded-xl border p-4 text-sm text-muted-foreground">
                  {tgStatus?.envFallback
                    ? 'Not connected via GUI — using TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from server env.'
                    : 'Not connected. Enter your bot token and chat ID below, then hit Connect.'}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2"><Label>Bot token (encrypted at rest AES-256-GCM)</Label><Input placeholder="123456:ABC-..." type="password" value={botToken} onChange={e=>setBotToken(e.target.value)}/></div>
                <div className="space-y-2"><Label>Chat ID</Label><Input placeholder="@your_chat or 123456789" value={telegramChatId} onChange={e=>setTelegramChatId(e.target.value)}/></div>
              </div>
              {tgMsg && (
                <div className={`rounded-xl border px-4 py-2 text-sm ${tgMsg.ok ? 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' : 'border-red-500/30 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400'}`}>{tgMsg.text}</div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={connectTg} disabled={tgBusy || !botToken || !telegramChatId}>{tgBusy ? 'Working…' : <><Send className="h-4 w-4"/> Connect</>}</Button>
                <Button variant="outline" onClick={verifyTg} disabled={tgBusy || !botToken || !telegramChatId}>Send test message</Button>
                {tgStatus?.connected && <Button variant="outline" onClick={disconnectTg} disabled={tgBusy}><Unplug className="h-4 w-4"/> Disconnect</Button>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
