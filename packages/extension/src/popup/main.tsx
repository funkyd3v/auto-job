import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useConfigStore } from '../stores/config-store.js';
import { getBackendConfig } from '../stores/config-store.js';

interface Source {
  id: string;
  name: string;
  source_type: string;
  is_enabled: boolean;
  schedule: string;
}

function PopupApp() {
  const { isConfigured, load } = useConfigStore();
  const [status, setStatus] = useState<string>('idle');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);

  const fetchSources = useCallback(async () => {
    const cfg = await getBackendConfig();
    if (!cfg) return;
    try {
      const res = await fetch(`${cfg.backendUrl.replace(/\/$/, '')}/api/sources`, {
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
      });
      if (res.ok) {
        const body = await res.json() as { data: Source[] };
        setSources(body.data ?? []);
      }
    } catch (err) {
      console.error('[Popup] fetchSources failed', err);
    }
  }, []);

  useEffect(() => {
    load();
    chrome.storage.local.get('lastSchedulerSync').then((v) => setLastSync((v as Record<string, string>).lastSchedulerSync ?? null));
    fetchSources();
  }, [load, fetchSources]);

  const toggleSource = async (sourceId: string, enabled: boolean) => {
    const cfg = await getBackendConfig();
    if (!cfg) return;
    try {
      await fetch(`${cfg.backendUrl.replace(/\/$/, '')}/api/sources/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
        body: JSON.stringify({ is_enabled: enabled }),
      });
      setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, is_enabled: enabled } : s)));
      // Re-sync scheduler after toggle
      chrome.runtime.sendMessage({ type: 'SYNC_SCHEDULER' });
    } catch (err) {
      console.error('[Popup] toggleSource failed', err);
    }
  };

  const runAll = async () => {
    setStatus('running');
    const res = await chrome.runtime.sendMessage({ type: 'RUN_ALL' });
    setStatus(res?.ok ? 'done' : `error: ${res?.error}`);
    setTimeout(() => setStatus('idle'), 3000);
  };

  const runSource = async (sourceId: string) => {
    setStatus('running');
    const res = await chrome.runtime.sendMessage({ type: 'RUN_SOURCE', sourceId });
    setStatus(res?.ok ? 'done' : `error: ${res?.error}`);
    setTimeout(() => setStatus('idle'), 3000);
  };

  const sync = async () => {
    setStatus('syncing');
    const res = await chrome.runtime.sendMessage({ type: 'SYNC_SCHEDULER' });
    setStatus(res?.ok ? 'synced' : `error: ${res?.error}`);
    setTimeout(() => setStatus('idle'), 2000);
  };

  if (!isConfigured) {
    return (
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: 0 }}>AutoJob — Not configured</h3>
        <p style={{ fontSize: 13, opacity: 0.8 }}>Set backend URL and API key in Options.</p>
        <button onClick={() => chrome.runtime.openOptionsPage()} style={btn}>Open Options</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, width: 320 }}>
      <h3 style={{ margin: 0 }}>AutoJob</h3>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Last sync: {lastSync ?? 'never'}</div>

      {/* Sources */}
      {sources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase' }}>Sources</div>
          {sources.map((source) => (
            <div key={source.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6, border: '1px solid #eee', background: '#fafafa' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{source.name}</span>
                <span style={{ fontSize: 10, opacity: 0.5 }}>{source.source_type} · {source.schedule}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => runSource(source.id)} style={{ ...btn, padding: '4px 8px', fontSize: 11 }} disabled={!source.is_enabled}>Run</button>
                <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 20, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={source.is_enabled}
                    onChange={(e) => toggleSource(source.id, e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: source.is_enabled ? '#111' : '#ccc',
                    borderRadius: 20, transition: '0.2s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2, left: source.is_enabled ? 18 : 2,
                      width: 16, height: 16, background: '#fff', borderRadius: '50%',
                      transition: '0.2s',
                    }} />
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={runAll} style={btnPrimary}>Run all now</button>
        <button onClick={sync} style={btn}>Sync schedules</button>
      </div>
      <button onClick={() => chrome.runtime.openOptionsPage()} style={btn}>Options</button>
      <div style={{ fontSize: 12, opacity: 0.6, minHeight: 16 }}>{status !== 'idle' ? status : ''}</div>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#111', color: '#fff', borderColor: '#111' };

const root = document.getElementById('root');
if (root) createRoot(root).render(<PopupApp />);
