// Use relative URL via Vite/Nginx proxy to avoid CORS across ports.
// Set VITE_API_URL only if you need direct backend URL (e.g. http://VPS_IP:3000). Empty = same-origin proxy.
const API_URL = (import.meta as any).env?.VITE_API_URL ?? ''

function buildUrl(path: string) {
  if (!API_URL) return path // relative -> proxied
  return `${API_URL.replace(/\/$/, '')}${path}`
}

type FetchOptions = RequestInit & { skipAuth?: boolean }

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('accessToken')
  }

  private async request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(opts.headers as Record<string, string>),
    }
    // Only send JSON content-type when there is a body — Fastify throws
    // "Body cannot be empty when content-type is set to 'application/json'" for DELETE/GET with empty body
    if (opts.body !== undefined && opts.body !== null) {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
    }
    const token = this.getToken()
    if (token && !opts.skipAuth) headers['Authorization'] = `Bearer ${token}`

    const url = buildUrl(path)
    const res = await fetch(url, {
      ...opts,
      headers,
      credentials: 'include',
    })

    // try refresh on 401
    if (res.status === 401 && !opts.skipAuth && !path.includes('/auth/refresh') && !path.includes('/auth/login')) {
      const refreshed = await this.tryRefresh()
      if (refreshed) {
        const newToken = this.getToken()
        if (newToken) headers['Authorization'] = `Bearer ${newToken}`
        const retry = await fetch(url, { ...opts, headers, credentials: 'include' })
        if (!retry.ok) throw await this.toError(retry)
        if (retry.status === 204) return undefined as T
        return retry.json()
      }
    }

    if (!res.ok) throw await this.toError(res)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return text ? JSON.parse(text) : (undefined as T)
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetch(buildUrl('/api/auth/refresh'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!res.ok) return false
      const data = await res.json()
      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken)
        return true
      }
      return false
    } catch { return false }
  }

  private async toError(res: Response) {
    let body: any = {}
    try { body = await res.json() } catch {}
    const err: any = new Error(body.message || body.error || `Request failed ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }

  // Auth
  login(email: string, password: string) {
    return this.request<{ accessToken: string; user: { email: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    })
  }
  logout() { return this.request('/api/auth/logout', { method: 'POST' }) }
  refresh() { return this.request<{ accessToken: string }>('/api/auth/refresh', { method: 'POST', body: JSON.stringify({}) }) }

  // Skills
  getSkills(params?: Record<string,string>) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
    return this.request<{ data: any[] }>(`/api/skills${qs}`)
  }
  createSkill(body: any) { return this.request<{ data: any }>('/api/skills', { method: 'POST', body: JSON.stringify(body) }) }
  updateSkill(id: string, body: any) { return this.request<{ data: any }>(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify(body) }) }
  deleteSkill(id: string) { return this.request(`/api/skills/${id}`, { method: 'DELETE' }) }

  // Matching
  getMatchSettings() { return this.request<{ data: { min_match_percentage: number; notify_on_match: boolean } }>('/api/settings/match') }
  updateMatchSettings(body: { min_match_percentage?: number; notify_on_match?: boolean }) {
    return this.request<{ data: any }>('/api/settings/match', { method: 'PATCH', body: JSON.stringify(body) })
  }
  previewMatch(body: { title: string; description: string }) {
    return this.request<{ data: { result: any; eligible: boolean; threshold: number } }>('/api/matching/preview', { method: 'POST', body: JSON.stringify(body) })
  }
  rematchJob(id: string) { return this.request<{ data: any }>(`/api/jobs/${id}/rematch`, { method: 'POST' }) }

  // Jobs
  getJobs(params?: Record<string,string>) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
    return this.request<{ data: any[]; pagination: { page:number; limit:number; total:number; pages:number } }>(`/api/jobs${qs}`)
  }
  getJob(id: string) { return this.request<{ data: any }>(`/api/jobs/${id}`) }
  deleteJob(id: string) { return this.request<{ success: boolean; message?: string }>(`/api/jobs/${id}`, { method: 'DELETE' }) }
  updateJobStatus(id: string, body: { status: string; note?: string }) {
    return this.request<{ data: any }>(`/api/jobs/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) })
  }

  // Sources
  getSources() { return this.request<{ data: any[] }>('/api/sources') }
  createSource(body: any) { return this.request<{ data: any }>('/api/sources', { method: 'POST', body: JSON.stringify(body) }) }
  updateSource(id: string, body: any) { return this.request<{ data: any }>(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }) }
  deleteSource(id: string) { return this.request(`/api/sources/${id}`, { method: 'DELETE' }) }

  // Scrape runs
  getScrapeRuns(params?: Record<string,string>) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
    return this.request<{ data: any[]; pagination?: any }>(`/api/scrape-runs${qs}`)
  }

  // Notifications
  getNotifications(params?: Record<string,string>) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
    return this.request<{ data: any[] }>(`/api/notifications${qs}`)
  }

  // Telegram
  getTelegramStatus() {
    return this.request<{ data: { connected: boolean; botUsername?: string|null; chatId?: string|null; notifyOnMatch: boolean; envFallback: boolean } }>('/api/telegram/status')
  }
  telegramConnect(body: { botToken: string; chatId: string }) {
    return this.request<{ success: boolean; data?: { botUsername?: string|null; chatId?: string|null }; message?: string }>('/api/telegram/connect', { method: 'POST', body: JSON.stringify(body) })
  }
  telegramVerify(body: { botToken: string; chatId: string }) {
    return this.request<{ success: boolean; message?: string }>('/api/telegram/verify', { method: 'POST', body: JSON.stringify(body) })
  }
  telegramDisconnect() {
    return this.request<{ success: boolean; message?: string }>('/api/telegram/disconnect', { method: 'DELETE' })
  }

  // API Keys
  getApiKeys() { return this.request<{ keys: any[] }>('/api/api-keys') }
  createApiKey(body: { name: string; scopes: string[]; expiresInDays?: number }) {
    return this.request<{ key: any; message: string }>('/api/api-keys', { method: 'POST', body: JSON.stringify(body) })
  }
  revokeApiKey(id: string) { return this.request(`/api/api-keys/${id}`, { method: 'DELETE' }) }

  // Scheduler
  getScheduleConfig() {
    return this.request<{ data: { enabled: boolean; times: string[]; nextRuns: string[] } }>('/api/scheduler/config')
  }
  updateScheduleConfig(body: { schedule_enabled: boolean; schedule_times: string[] }) {
    return this.request<{ data: { enabled: boolean; times: string[]; nextRuns: string[]; jobsCreated: number } }>('/api/scheduler/config', { method: 'PUT', body: JSON.stringify(body) })
  }
  triggerScheduleNow() {
    return this.request<{ data: { jobsQueued: number } }>('/api/scheduler/trigger', { method: 'POST' })
  }
  getScheduleJobs() {
    return this.request<{ data: Array<{ id: string; time: string; sourceId: string; nextRun: string }> }>('/api/scheduler/jobs')
  }

  // Health
  health() { return this.request<{ status: string }>('/health', { skipAuth: true }) }
}

export const api = new ApiClient()
export { API_URL }
