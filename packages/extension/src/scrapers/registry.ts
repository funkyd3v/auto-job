import type { JobSourceAdapter } from './base.js';
import type { Source } from '../lib/types.js';

import { IndeedAdapter } from './indeed.js';
import { BdjobsAdapter } from './bdjobs.js';

/**
 * Registry — Open/Closed: register new adapters without modifying orchestrator.
 * DIP: orchestrator depends on abstraction (registry), not concretions.
 */
export class AdapterRegistry {
  private adapters: JobSourceAdapter[] = [];

  constructor() {
    // Register all adapters at construction
    this.register(new IndeedAdapter());
    this.register(new BdjobsAdapter());
  }

  register(adapter: JobSourceAdapter): void {
    if (this.adapters.some((a) => a.sourceType === adapter.sourceType)) {
      throw new Error(`Adapter already registered: ${adapter.sourceType}`);
    }
    this.adapters.push(adapter);
  }

  resolve(source: Source): JobSourceAdapter {
    const adapter = this.adapters.find((a) => a.canHandle(source));
    if (!adapter) throw new Error(`No adapter for source_type: ${source.source_type} (id: ${source.id})`);
    return adapter;
  }

  all(): readonly JobSourceAdapter[] {
    return this.adapters;
  }
}

// Singleton for background; tests may create isolated instances.
export const globalAdapterRegistry = new AdapterRegistry();
