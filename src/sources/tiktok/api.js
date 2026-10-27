import { retryFetch } from '../../utils/http.js';
import { sleep, tiktokRateLimiter } from '../../utils/rate-limit.js';
import { loadRaw, saveRaw } from '../../storage/cache.js';

function getClientConfig() {
  return {
    apiKey: process.env.RAPIDAPI_KEY || '',
    apiHost: process.env.RAPIDAPI_HOST || 'tiktok-scraper7.p.rapidapi.com',
  };
}

function defaultHeaders() {
  const { apiKey, apiHost } = getClientConfig();
  return {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': apiHost,
  };
}

export async function searchHashtag(hashtag, count = 20, pages = 1) {
  const { apiHost } = getClientConfig();
  const users = [];
  const seen = new Set();

  for (let page = 0; page < pages; page++) {
    const offset = page * count;
    const url = `https://${apiHost}/feed/search?keywords=${encodeURIComponent(hashtag)}&count=${count}&offset=${offset}&sort_type=0`;

    await tiktokRateLimiter.acquire();
    const resp = await retryFetch(url, {
      headers: { ...defaultHeaders(), 'Content-Type': 'application/json' },
    });

    if (!resp) break;

    const videos = resp.data?.data?.videos || resp.data?.item_list || [];
    for (const v of videos) {
      const uid = v.author?.id || v.author?.uid;
      const uniqueId = v.author?.unique_id || '';
      if (uid && uniqueId && !seen.has(uid)) {
        seen.add(uid);
        users.push({
          user_id: uid,
          unique_id: uniqueId,
          nickname: v.author?.nickname || '',
          source_hashtag: hashtag,
        });
      }
    }
    if (!videos.length) break;
    if (page < pages - 1) await sleep(500);
  }
  return users;
}

function isApiError(respData) {
  if (respData && respData.code !== undefined && respData.code !== 0 && !respData.user) return true;
  return false;
}

export async function getUserDetails(uniqueId) {
  const cached = loadRaw(uniqueId, 'user_info');
  if (cached) return cached;

  const { apiHost } = getClientConfig();
  const url = `https://${apiHost}/user/info?unique_id=${encodeURIComponent(uniqueId)}`;

  await tiktokRateLimiter.acquire();
  const resp = await retryFetch(url, { headers: defaultHeaders() });
  if (!resp) return null;

  if (isApiError(resp.data)) {
    console.log(`    API error for @${uniqueId}: ${resp.data.msg || 'unknown error'}`);
    return null;
  }

  const d = resp.data?.data || resp.data;
  if (!d.user) return null;

  const result = {
    user_id: d.user?.id || null,
    user: d.user,
    stats: d.stats || {},
  };
  saveRaw(uniqueId, 'user_info', result);
  return result;
}

export async function searchUserId(handle) {
  const { apiHost } = getClientConfig();
  const url = `https://${apiHost}/user/search?keywords=${encodeURIComponent(handle)}&count=10&cursor=0&other_pref=1`;

  await tiktokRateLimiter.acquire();
  const resp = await retryFetch(url, { headers: defaultHeaders() });
  if (!resp) return null;

  const list = resp.data?.data?.user_list || resp.data?.user_list || [];
  const match = list.find(e => e.user?.uniqueId?.toLowerCase() === handle.toLowerCase());
  return match?.user?.id ? String(match.user.id) : null;
}

export async function getUserPosts(uniqueId, count = 10) {
  const cached = loadRaw(uniqueId, 'posts');
  if (cached) return cached;

  const { apiHost } = getClientConfig();
  const url = `https://${apiHost}/user/posts?unique_id=${encodeURIComponent(uniqueId)}&count=${count}&cursor=0&sort_type=0`;

  await tiktokRateLimiter.acquire();
  const resp = await retryFetch(url, { headers: defaultHeaders() });
  if (!resp) return [];

  if (isApiError(resp.data)) return [];

  const videos = resp.data?.data?.videos || resp.data?.videos || [];
  const posts = videos.map(v => ({
    title: v.title || '',
    region: v.region || null,
    music_id: v.music_info?.id || null,
    music_title: v.music_info?.title || null,
    mentioned_user_ids: typeof v.mentioned_users === 'string' && v.mentioned_users
      ? [v.mentioned_users]
      : Array.isArray(v.mentioned_users) ? v.mentioned_users : [],
  })).filter(v => v.title);
  saveRaw(uniqueId, 'posts', posts);
  return posts;
}

export async function searchByMusic(musicId, count = 20, cursor = 0) {
  const { apiHost } = getClientConfig();
  const url = `https://${apiHost}/music/posts?music_id=${encodeURIComponent(musicId)}&count=${count}&cursor=${cursor}`;

  await tiktokRateLimiter.acquire();
  const resp = await retryFetch(url, { headers: defaultHeaders() });
  if (!resp) return [];

  const videos = resp.data?.data?.videos || resp.data?.videos || [];
  const users = [];
  const seen = new Set();
  for (const v of videos) {
    const uid = v.author?.id || v.author?.uid;
    const uniqueId = v.author?.unique_id || '';
    if (uid && uniqueId && !seen.has(uid)) {
      seen.add(uid);
      users.push({ user_id: uid, unique_id: uniqueId, nickname: v.author?.nickname || '' });
    }
  }
  return users;
}
