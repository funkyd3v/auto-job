import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useConfigStore } from '../stores/config-store.js';

function OptionsApp() {
  const { backendUrl, apiKey, isConfigured, load, setConfig, clear } = useConfigStore();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    load().then(() => {
      // hydrate from store after load
      const s = useConfigStore.getState();
      setUrl(s.backendUrl);
      setKey(s.apiKey);
    });
  }, [load]);

  const save = async () => {
    const trimmedUrl = url.trim().replace(/\/$/, '');
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setMsg('Backend URL must start with https://');
      return;
    }
    if (!key.trim() || !key.startsWith('aj_')) {
      setMsg('API key must start with aj_ (generate in dashboard)');
      return;
    }
    await setConfig({ backendUrl: trimmedUrl, apiKey: key.trim() });
    await chrome.runtime.sendMessage({ type: 'SYNC_SCHEDULER' }).catch(() => {});
    setMsg('Saved — scheduler synced');
    setTimeout(() => setMsg(''), 2000);
  };

  return (
    <div style={{ maxWidth: 560, margin: '32px auto', padding: 24 }}>
      <h2>AutoJob — Options</h2>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        Backend is the source of truth. Extension only executes schedule. Configure scoped API key with{' '}
        <code>jobs:write</code>, <code>sources:read</code>, <code>scrape-runs:write</code>.
      </p>

      <label style={lbl}>Backend URL</label>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" style={inp} />

      <label style={lbl}>API Key (X-Api-Key)</label>
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="aj_..." style={inp} type="password" />

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={save} style={btnPrimary}>Save</button>
        <button onClick={async () => { await clear(); setUrl(''); setKey(''); setMsg('Cleared'); }} style={btn}>Clear</button>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: msg.includes('Saved') ? 'green' : '#b00' }}>{msg}</div>
      <div style={{ marginTop: 16, fontSize: 12, opacity: 0.6 }}>
        Status: {isConfigured ? 'configured' : 'not configured'} — version {chrome.runtime.getManifest().version}
      </div>

      <hr style={{ margin: '24px 0' }} />
      <h3>Security</h3>
      <ul style={{ fontSize: 13, opacity: 0.8 }}>
        <li>Permissions minimal: storage, alarms, tabs, scripting + host per source</li>
        <li>No remote JS execution — only bundled content scripts</li>
        <li>Scraped data sanitized before submission</li>
        <li>API key stored in chrome.storage.local, never logged</li>
      </ul>
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'block', marginTop: 12, fontWeight: 600, fontSize: 13 };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', marginTop: 6, boxSizing: 'border-box' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: '#111', color: '#fff', borderColor: '#111' };

const root = document.getElementById('root');
if (root) createRoot(root).render(<OptionsApp />);
