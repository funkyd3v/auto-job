import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, ShieldCheck, Loader2, Eye, EyeOff } from 'lucide-react'

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const { login, register, isLoading, error } = useAuthStore()
  const nav = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (mode === 'register') await register(email, password)
      else await login(email, password)
      nav('/overview')
    } catch {}
  }

  return (
    <div className="min-h-screen flex">
      {/* Left — form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-background relative overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-[0.04]" />
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-gradient-to-br from-violet-600/20 to-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-gradient-to-br from-fuchsia-500/10 to-violet-500/10 rounded-full blur-3xl" />

        <div className="w-full max-w-md relative">
          <div className="mb-8 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">Job Hunter</h1>
              <p className="text-xs text-muted-foreground">Premium Job Automation</p>
            </div>
          </div>

          <Card className="border-border/60 shadow-xl backdrop-blur">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl">{mode === 'login' ? 'Welcome back' : 'Create account'}</CardTitle>
              <CardDescription>{mode === 'login' ? 'Sign in to your automation dashboard' : 'Set up your single-user account'}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)} required className="h-11" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <span className="text-xs text-muted-foreground">{mode === 'register' ? 'Min 8 characters' : 'Single-user system'}</span>
                  </div>
                  <div className="relative">
                    <Input id="password" type={show ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8} className="h-11 pr-10" />
                    <button type="button" onClick={()=>setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {show ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                    </button>
                  </div>
                </div>

                {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>}

                <Button type="submit" disabled={isLoading} className="w-full h-11 text-[15px] font-semibold">
                  {isLoading ? <><Loader2 className="h-4 w-4 animate-spin"/> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</> : mode === 'login' ? 'Sign in' : 'Create account'}
                </Button>
                <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5"/> Secured by JWT • bcrypt • Rate limited
                </p>
              </form>
              <div className="mt-4 text-center text-sm text-muted-foreground">
                {mode === 'login' ? (
                  <>No account yet?{' '}<button onClick={()=>setMode('register')} className="text-primary hover:underline font-medium">Create one</button></>
                ) : (
                  <>Already have an account?{' '}<button onClick={()=>setMode('login')} className="text-primary hover:underline font-medium">Sign in</button></>
                )}
              </div>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-6">Backend is source of truth — scrapers validate, deduplicate & match.</p>
        </div>
      </div>

      {/* Right — premium showcase */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-[#0A0A0F] text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-700 via-indigo-700 to-fuchsia-700 opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,white_1px,transparent_1px)] [background-size:32px_32px] opacity-10" />
        <div className="relative flex flex-col justify-between p-12 w-full max-w-[560px] mx-auto">
          <div />
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 py-1 text-xs font-medium border border-white/10">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"/> Live matching engine
            </div>
            <h2 className="text-4xl font-bold leading-tight tracking-tight">One logical job<br/>One record<br/><span className="text-white/70">One notification</span></h2>
            <p className="text-white/70 leading-relaxed">Server-side Playwright scrapers pull listings, the backend matches them against your skills, deduplicates at the database level, and notifies you via Telegram.</p>
            <div className="grid grid-cols-3 gap-3 pt-4">
              {[
                { k: 'DEDUP', v: 'DB-level', d: 'fingerprint + external_id' },
                { k: 'MATCH', v: 'Backend', d: 'threshold & weights' },
                { k: 'NOTIFY', v: 'Once', d: 'unique(job,channel,type)' },
              ].map(s=>(
                <div key={s.k} className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 p-4">
                  <div className="text-[10px] tracking-widest text-white/60">{s.k}</div>
                  <div className="font-semibold">{s.v}</div>
                  <div className="text-xs text-white/60">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-white/50">Playwright • Fastify + Prisma • BullMQ → Telegram</div>
        </div>
      </div>
    </div>
  )
}
