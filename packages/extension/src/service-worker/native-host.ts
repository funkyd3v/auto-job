/**
 * NativeHost — Connection manager for Chrome Native Messaging.
 *
 * Manages the lifecycle of the connection to the Python native host:
 * - Connect/disconnect
 * - Auto-reconnect on disconnect
 * - Message sending with timeout
 * - Error handling
 */

const NATIVE_HOST_NAME = 'com.autojob.scraper';
const MESSAGE_TIMEOUT_MS = 60_000; // 60 seconds for slow scrape operations
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 3;

export interface NativeHostConfig {
  onDisconnect?: (error?: string) => void;
  onReconnect?: (attempt: number) => void;
}

export class NativeHost {
  private port: chrome.runtime.Port | null = null;
  private pendingMessages = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private messageId = 0;
  private reconnectAttempts = 0;
  private connecting = false;
  private config: NativeHostConfig;

  constructor(config: NativeHostConfig = {}) {
    this.config = config;
  }

  /**
   * Connect to the native host.
   * If already connected, returns existing connection.
   */
  connect(): void {
    if (this.port || this.connecting) return;

    this.connecting = true;

    try {
      this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

      this.port.onMessage.addListener((message) => {
        this.handleMessage(message);
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message ?? 'Host disconnected';
        console.warn('[NativeHost] disconnected:', error);
        this.port = null;
        this.connecting = false;

        // Reject all pending messages
        for (const [id, pending] of this.pendingMessages) {
          clearTimeout(pending.timer);
          pending.reject(new Error(error));
          this.pendingMessages.delete(id);
        }

        this.config.onDisconnect?.(error);
        this.tryReconnect();
      });

      this.connecting = false;
      this.reconnectAttempts = 0;
      console.info('[NativeHost] connected to', NATIVE_HOST_NAME);
    } catch (err) {
      this.connecting = false;
      console.error('[NativeHost] connection failed:', err);
      this.tryReconnect();
    }
  }

  /**
   * Disconnect from the native host.
   */
  disconnect(): void {
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
    for (const [id, pending] of this.pendingMessages) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
      this.pendingMessages.delete(id);
    }
  }

  /**
   * Check if connected to the native host.
   */
  get isConnected(): boolean {
    return this.port !== null;
  }

  /**
   * Send a message and wait for response.
   *
   * @param message - Message to send
   * @param timeoutMs - Timeout in milliseconds
   * @returns Response from native host
   */
  async send<T = unknown>(
    message: Record<string, unknown>,
    timeoutMs: number = MESSAGE_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.port) {
      throw new Error('Not connected to native host');
    }

    const id = String(++this.messageId);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMessages.delete(id);
        reject(new Error(`Message timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingMessages.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      try {
        this.port!.postMessage({ ...message, _id: id });
      } catch (err) {
        clearTimeout(timer);
        this.pendingMessages.delete(id);
        reject(new Error(`Failed to send message: ${err}`));
      }
    });
  }

  /**
   * Send a message without waiting for response (fire-and-forget).
   */
  sendNoResponse(message: Record<string, unknown>): void {
    if (!this.port) {
      throw new Error('Not connected to native host');
    }
    this.port.postMessage(message);
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Check if this is a response to a pending message
    const id = message._id as string | undefined;
    if (id && this.pendingMessages.has(id)) {
      const pending = this.pendingMessages.get(id)!;
      clearTimeout(pending.timer);
      this.pendingMessages.delete(id);

      // Check for error responses
      if (message.type === 'ERROR') {
        pending.reject(new Error((message.payload as { message?: string })?.message ?? 'Unknown error'));
      } else {
        pending.resolve(message);
      }
      return;
    }

    // Otherwise, it's a push message from the host
    console.info('[NativeHost] push message:', message.type);
  }

  private tryReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[NativeHost] max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;

    console.info(`[NativeHost] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.config.onReconnect?.(this.reconnectAttempts);
      this.connect();
    }, delay);
  }
}
