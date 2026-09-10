import { create } from 'zustand';
import type { BackendConfig } from '../lib/types.js';

interface ConfigState {
  backendUrl: string;
  apiKey: string;
  isConfigured: boolean;
  setConfig: (cfg: BackendConfig) => Promise<void>;
  load: () => Promise<void>;
  clear: () => Promise<void>;
}

const STORAGE_KEY = 'autojob_backend_config';

export const useConfigStore = create<ConfigState>((set) => ({
  backendUrl: '',
  apiKey: '',
  isConfigured: false,

  load: async () => {
    const { [STORAGE_KEY]: cfg } = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, BackendConfig | undefined>;
    if (cfg?.backendUrl && cfg?.apiKey) {
      set({ backendUrl: cfg.backendUrl, apiKey: cfg.apiKey, isConfigured: true });
    } else {
      set({ backendUrl: '', apiKey: '', isConfigured: false });
    }
  },

  setConfig: async (cfg: BackendConfig) => {
    await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
    set({ backendUrl: cfg.backendUrl, apiKey: cfg.apiKey, isConfigured: true });
  },

  clear: async () => {
    await chrome.storage.local.remove(STORAGE_KEY);
    set({ backendUrl: '', apiKey: '', isConfigured: false });
  },
}));

// Helper for service worker (no React) — direct storage access
export async function getBackendConfig(): Promise<BackendConfig | null> {
  const { [STORAGE_KEY]: cfg } = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, BackendConfig | undefined>;
  if (!cfg?.backendUrl || !cfg?.apiKey) return null;
  return cfg;
}
