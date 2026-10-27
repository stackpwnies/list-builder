const CAMOFOX_BASE = 'http://localhost:9377';

export class CamoFoxSession {
  #userId
  #tabId

  constructor(userId) {
    this.#userId = userId;
    this.#tabId = null;
  }

  get tabId() {
    return this.#tabId;
  }

  get userId() {
    return this.#userId;
  }

  get isActive() {
    return this.#tabId !== null;
  }

  async init() {
    if (this.#tabId) return true;

    const resp = await fetch(`${CAMOFOX_BASE}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.#userId,
        sessionKey: 'backfill-main',
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await resp.json();
    this.#tabId = data.tabId;
    return !!this.#tabId;
  }

  async navigate(url) {
    this.#ensureTab();

    const resp = await fetch(`${CAMOFOX_BASE}/tabs/${this.#tabId}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.#userId, url }),
      signal: AbortSignal.timeout(15000),
    });

    return resp.ok;
  }

  async getSnapshot(options = {}) {
    this.#ensureTab();

    const { format = 'text', offset, includeScreenshot } = options;
    const params = new URLSearchParams({
      userId: this.#userId,
      format,
    });

    if (offset !== undefined) params.set('offset', String(offset));
    if (includeScreenshot) params.set('includeScreenshot', 'true');

    const resp = await fetch(
      `${CAMOFOX_BASE}/tabs/${this.#tabId}/snapshot?${params}`,
      { signal: AbortSignal.timeout(15000) },
    );

    if (!resp.ok) return null;
    const data = await resp.json();
    return data;  // { snapshot, url, refsCount, truncated, totalChars, hasMore, nextOffset }
  }

  async waitForLoad(ms = 2000) {
    const { sleep } = await import('../utils/rate-limit.js');
    await sleep(ms);
  }

  async closeTab() {
    if (!this.#tabId) return;

    try {
      await fetch(
        `${CAMOFOX_BASE}/tabs/${this.#tabId}?userId=${this.#userId}`,
        { method: 'DELETE', signal: AbortSignal.timeout(5000) },
      );
    } catch { /* ignore */ }

    this.#tabId = null;
  }

  async destroySession() {
    try {
      await fetch(`${CAMOFOX_BASE}/sessions/${this.#userId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* ignore */ }
  }

  async cleanup() {
    await this.closeTab();
    await this.destroySession();
  }

  #ensureTab() {
    if (!this.#tabId) {
      throw new Error('Session not initialized. Call init() first.');
    }
  }
}
