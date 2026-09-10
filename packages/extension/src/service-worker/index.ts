/**
 * Service Worker — MV3 entry. Wires scheduler, orchestrator, api-client, adapters.
 * No remote code exec: only bundled code, JSON fetch.
 *
 * v0.2.0: Added native host lifecycle management.
 *   - Connects to Python native host on startup
 *   - Reconnects on disconnect
 *   - Provides ping/status for popup
 */

import { getBackendConfig } from '../stores/config-store.js';
import { Scheduler } from './scheduler.js';
import { ScrapeOrchestrator } from './orchestrator.js';
import { ApiClient } from './api-client.js';
import { globalAdapterRegistry } from '../scrapers/registry.js';
import { LinkedInAdapter } from '../scrapers/linkedin.js';
import { IndeedAdapter } from '../scrapers/indeed.js';
import { getNativeBridge } from './native-bridge.js';

const EXTENSION_VERSION = chrome.runtime.getManifest().version ?? '0.2.0';

// Register adapters — OCP: add new adapters here without touching orchestrator
globalAdapterRegistry.register(new LinkedInAdapter());
globalAdapterRegistry.register(new IndeedAdapter());

const scheduler = new Scheduler();
const nativeBridge = getNativeBridge();

let orchestrator: ScrapeOrchestrator | null = null;

async function getApiClient(): Promise<ApiClient | null> {
  const cfg = await getBackendConfig();
  if (!cfg) return null;
  return new ApiClient({ backendUrl: cfg.backendUrl, apiKey: cfg.apiKey, extensionVersion: EXTENSION_VERSION });
}

async function buildOrchestrator(): Promise<ScrapeOrchestrator | null> {
  const client = await getApiClient();
  if (!client) return null;
  return new ScrapeOrchestrator({
    apiClient: client,
    registry: globalAdapterRegistry,
    getSources: () => client.getSources(),
    extensionVersion: EXTENSION_VERSION,
  });
}

async function syncScheduler(): Promise<void> {
  const client = await getApiClient();
  if (!client) {
    console.warn('[SW] not configured — skipping scheduler sync');
    return;
  }
  try {
    const sources = await client.getSources();
    await scheduler.sync(sources);
    console.info(`[SW] scheduler synced: ${sources.filter((s) => s.is_enabled).length} enabled`);
  } catch (err) {
    console.error('[SW] scheduler sync failed', err);
  }
}

/**
 * Ensure native host connection is established.
 * Called on startup and before scraping operations.
 */
function ensureNativeHost(): void {
  try {
    nativeBridge.ensureConnected();
    console.info('[SW] native host connection initiated');
  } catch (err) {
    console.warn('[SW] native host connection failed:', err);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.info('[SW] installed', EXTENSION_VERSION);
  ensureNativeHost();
  await syncScheduler();
});

chrome.runtime.onStartup.addListener(async () => {
  ensureNativeHost();
  await syncScheduler();
  // Flush offline queue on startup
  const client = await getApiClient();
  if (client) client.flushQueue().catch(() => {});
});

// Periodic sync — backend is canonical; refresh every 30m
chrome.alarms.create('sync-scheduler', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sync-scheduler') await syncScheduler();
});

// Delegate scrape alarms to orchestrator
scheduler.onAlarm(async (sourceId) => {
  if (!orchestrator) orchestrator = await buildOrchestrator();
  if (!orchestrator) {
    console.warn('[SW] orchestrator not ready — missing config');
    return;
  }
  await orchestrator.runScrape(sourceId);
});

// ─── Message handlers — popup/options → SW ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  (async () => {
    const m = msg as { type: string; sourceId?: string };
    if (m.type === 'SYNC_SCHEDULER') {
      await syncScheduler();
      sendResponse({ ok: true });
    } else if (m.type === 'RUN_SOURCE' && m.sourceId) {
      if (!orchestrator) orchestrator = await buildOrchestrator();
      if (!orchestrator) return sendResponse({ ok: false, error: 'Not configured' });
      await orchestrator.runScrape(m.sourceId);
      sendResponse({ ok: true });
    } else if (m.type === 'RUN_ALL') {
      if (!orchestrator) orchestrator = await buildOrchestrator();
      if (!orchestrator) return sendResponse({ ok: false, error: 'Not configured' });
      await orchestrator.runAll();
      sendResponse({ ok: true });
    } else if (m.type === 'GET_STATUS') {
      const cfg = await getBackendConfig();
      const nativeHostOk = await nativeBridge.ping().catch(() => false);
      sendResponse({
        configured: !!cfg,
        version: EXTENSION_VERSION,
        nativeHost: nativeHostOk,
      });
    } else if (m.type === 'PING_NATIVE_HOST') {
      const ok = await nativeBridge.ping().catch(() => false);
      sendResponse({ ok });
    } else {
      sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // keep channel open for async
});
