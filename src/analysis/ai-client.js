import { retryFetch } from '../utils/http.js';
import { loadRaw, saveRaw } from '../storage/cache.js';

function getEnvConfig() {
  return {
    baseUrl: process.env.AI_BASE_URL || 'https://api.kilo.ai/api/gateway/v1/chat/completions',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'google/gemini-2.0-flash-001',
  };
}

export async function aiChat(messages, { model, cacheHandle, cacheType, skipCache } = {}) {
  if (!skipCache && cacheHandle && cacheType) {
    const cached = loadRaw(cacheHandle, cacheType);
    if (cached && Object.keys(cached).length > 0) return cached;
  }

  const env = getEnvConfig();

  const resp = await retryFetch(env.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.apiKey}`,
    },
    body: {
      model: model || env.model,
      messages,
      max_tokens: 1000,
      temperature: 0.1,
    },
    timeout: 20000,
    retryOn: [429],
    attempts: 3,
    baseDelay: 3000,
  });

  if (!resp) return {};

  const content = resp.data?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    let cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  if (cacheHandle && cacheType) {
    saveRaw(cacheHandle, cacheType, parsed);
  }

  return parsed;
}
