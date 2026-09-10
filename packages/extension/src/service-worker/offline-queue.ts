/**
 * OfflineQueue — SRP wrapper around chrome.storage.local for deferred submissions.
 * Extension never loses scraped jobs on transient network/backend failure.
 */

export interface QueuedItem {
  id: string;
  sourceId: string;
  payload: unknown;
  idempotencyKey: string;
  attempts: number;
  createdAt: string;
}

const STORAGE_KEY = 'autojob_offline_queue_v2';

export class OfflineQueue {
  async push(item: QueuedItem): Promise<void> {
    const queue = await this.list();
    queue.push(item);
    await chrome.storage.local.set({ [STORAGE_KEY]: queue.slice(-200) });
  }

  async list(): Promise<QueuedItem[]> {
    const { [STORAGE_KEY]: q = [] } = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, QueuedItem[]>;
    return q;
  }

  async remove(id: string): Promise<void> {
    const q = await this.list();
    await chrome.storage.local.set({ [STORAGE_KEY]: q.filter((i) => i.id !== id) });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  async incrementAttempts(id: string): Promise<void> {
    const q = await this.list();
    const idx = q.findIndex((i) => i.id === id);
    if (idx >= 0) {
      q[idx].attempts += 1;
      await chrome.storage.local.set({ [STORAGE_KEY]: q });
    }
  }
}
