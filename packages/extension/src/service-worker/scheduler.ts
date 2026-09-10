import { cronToPeriodMinutes, getAlarmName } from '../utils/cron.js';
import type { Source } from '../lib/types.js';

/**
 * Scheduler — owns chrome.alarms lifecycle, but schedule config is backend-owned.
 * Dashboard → Backend stores cron → Extension syncs → chrome.alarms.
 * SOLID: single responsibility — alarm management.
 */

export class Scheduler {
  /** Sync alarms to current enabled sources. Clears stale alarms. */
  async sync(sources: Source[]): Promise<void> {
    const enabled = sources.filter((s) => s.is_enabled);

    // Clear alarms for disabled/removed sources
    const alarms = await chrome.alarms.getAll();
    const wanted = new Set(enabled.map((s) => getAlarmName(s.id)));
    for (const alarm of alarms) {
      if (alarm.name.startsWith('scrape-') && !wanted.has(alarm.name)) {
        await chrome.alarms.clear(alarm.name);
      }
    }

    // Create/update alarms for enabled sources
    for (const source of enabled) {
      const period = cronToPeriodMinutes(source.schedule);
      await chrome.alarms.create(getAlarmName(source.id), { periodInMinutes: period });
    }

    await chrome.storage.local.set({ lastSchedulerSync: new Date().toISOString(), schedulerSources: enabled.length });
  }

  /** Register alarm listener — delegates to orchestrator. */
  onAlarm(handler: (sourceId: string) => Promise<void>): void {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (!alarm.name.startsWith('scrape-')) return;
      const sourceId = alarm.name.replace('scrape-', '');
      try {
        await handler(sourceId);
      } catch (err) {
        console.error(`[Scheduler] scrape failed for ${sourceId}`, err);
      }
    });
  }

  async triggerImmediate(sourceId: string): Promise<void> {
    // For popup "Run now" — fire without waiting for alarm
    await chrome.alarms.create(`manual-${sourceId}`, { when: Date.now() + 100 });
  }
}
