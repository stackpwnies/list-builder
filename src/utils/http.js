export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchJSON(url, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 15000);

  try {
    const resp = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body || undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    try {
      return { status: resp.status, data: JSON.parse(text), headers: resp.headers };
    } catch {
      return { status: resp.status, data: text, headers: resp.headers };
    }
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

export async function retryFetch(url, opts = {}) {
  const attempts = opts.attempts || 3;
  const baseDelay = opts.baseDelay || 2000;
  const retryOn = opts.retryOn || [429, 403];

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const resp = await fetchJSON(url, opts);

      if (retryOn.includes(resp.status)) {
        const retryAfterHeader = resp.headers?.get?.('retry-after') || resp.headers?.['retry-after'];
        let retryAfterMs = 0;
        if (retryAfterHeader) {
          const parsed = parseFloat(retryAfterHeader);
          retryAfterMs = parsed > 100 ? parsed : parsed * 1000;
        }
        const backoffMs = baseDelay * (attempt + 1);
        const delay = Math.max(backoffMs, retryAfterMs);
        console.log(`  Rate limited (${resp.status}), waiting ${(delay / 1000).toFixed(1)}s...${retryAfterMs ? ' (Retry-After)' : ''}`);
        await sleep(delay);
        continue;
      }

      return resp;
    } catch (e) {
      if (attempt === attempts - 1) throw e;
      await sleep(baseDelay * (attempt + 1));
    }
  }
  return null;
}
