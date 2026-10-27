import fs from 'fs';
import { aiChat } from '../analysis/ai-client.js';
import {
  BIO_ANALYSIS_SYSTEM, bioAnalysisUser,
  VISION_ANALYSIS_PROMPT,
  FULL_INFERENCE_SYSTEM, fullInferenceUser,
  ENRICHMENT_SYSTEM, enrichmentUser,
} from '../analysis/prompts.js';
import { qualify, isOnlyCountryDisqualified } from '../analysis/qualifiers.js';
import { loadRaw, saveRaw, rawPathFor } from '../storage/cache.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const HASHTAG_RE = /#[\w]+/g;
const BIO_EXCLUSION_WORDS = ['father', 'husband', 'dude', 'dad'];

const VISION_MODEL = process.env.VISION_MODEL || process.env.AI_MODEL || 'google/gemini-2.0-flash-001';

export function checkBioExclusions(bio) {
  const lower = ` ${bio.toLowerCase()} `;
  return BIO_EXCLUSION_WORDS.find(w => new RegExp(`[^a-z]${w}[^a-z]`).test(lower)) || null;
}

export function extractEmail(bio) {
  return bio.match(EMAIL_RE)?.[0] || null;
}

export async function analyzeBio(handle, bio, nickname) {
  return aiChat(
    [
      { role: 'system', content: BIO_ANALYSIS_SYSTEM },
      { role: 'user', content: bioAnalysisUser(handle, bio, nickname) },
    ],
    { cacheHandle: handle, cacheType: 'bio_analysis' }
  );
}

async function getAvatarBase64(handle, avatarUrl) {
  const cached = loadRaw(handle, 'avatar');
  if (cached?.base64) return cached.base64;

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    Referer: 'https://www.tiktok.com/',
  };

  try {
    const response = await fetch(avatarUrl, {
      headers: browserHeaders,
      redirect: 'follow',
    });

    if (!response.ok || response.status >= 400) {
      console.error(`  [avatar] @${handle} HTTP ${response.status} — skipping vision`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 1024) {
      console.error(`  [avatar] @${handle} too small (${buffer.byteLength}b) — skipping vision`);
      return null;
    }

    const base64 = Buffer.from(buffer).toString('base64');
    const mime = response.headers.get('content-type') || 'image/jpeg';

    saveRaw(handle, 'avatar', { mime, base64 });
    return base64;
  } catch (e) {
    console.error(`  [avatar] @${handle} download failed: ${e.message}`);
    return null;
  }
}

export async function analyzeVision(handle, avatarUrl) {
  if (!avatarUrl) return {};

  const base64 = await getAvatarBase64(handle, avatarUrl);
  if (!base64) return {};

  const cachedVision = loadRaw(handle, 'vision_analysis');
  if (cachedVision && Object.keys(cachedVision).length > 0) return cachedVision;

  const visionPath = rawPathFor(handle, 'vision_analysis');
  if (fs.existsSync(visionPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(visionPath, 'utf8'));
      if (Object.keys(raw).length === 0) {
        fs.unlinkSync(visionPath);
      }
    } catch { /* ignore */ }
  }

  try {
    const dataUri = `data:image/jpeg;base64,${base64}`;

    return aiChat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_ANALYSIS_PROMPT },
            { type: 'image', image: dataUri },
          ],
        },
      ],
      { model: VISION_MODEL, cacheHandle: handle, cacheType: 'vision_analysis', skipCache: true }
    );
  } catch (error) {
    console.error(`  Error in analyzeVision for @${handle}:`, error.message);
    return {};
  }
}

export function mergeAnalyses(bioAnalysis, visionAnalysis) {
  const finalGender = bioAnalysis.gender !== 'unknown'
    ? bioAnalysis.gender
    : (visionAnalysis.gender || 'unknown');

  const bioBY = bioAnalysis.birth_year || {};
  const visBY = visionAnalysis.birth_year || {};
  let birthYearMin = null;
  let birthYearMax = null;

  if (bioBY.min && bioBY.max) {
    birthYearMin = bioBY.min;
    birthYearMax = bioBY.max;
  }
  if (visBY.min && visBY.max) {
    if (birthYearMin) {
      birthYearMin = Math.max(birthYearMin, visBY.min);
      birthYearMax = Math.min(birthYearMax, visBY.max);
    } else {
      birthYearMin = visBY.min;
      birthYearMax = visBY.max;
    }
  }

  return { finalGender, birthYearMin, birthYearMax };
}

export async function inferCountryFromPosts(posts, targetCountry, handle) {
  if (!posts.length) return { country: null, state: null, first_name: null, last_name: null, confidence: { country: 0, state: 0, name: 0 } };
  return aiChat(
    [
      { role: 'system', content: FULL_INFERENCE_SYSTEM },
      { role: 'user', content: fullInferenceUser(posts, targetCountry) },
    ],
    { cacheHandle: handle, cacheType: 'posts_country' }
  );
}

export async function enrichFromPosts(handle, posts, result, cfg) {
  const cached = loadRaw(handle, 'enrichment');
  if (cached) return cached;

  const allTags = new Set();
  for (const p of posts) {
    const matches = p.title.match(HASHTAG_RE);
    if (matches) for (const t of matches) allTags.add(t.toLowerCase());
  }

  const enrichment = await aiChat(
    [
      { role: 'system', content: ENRICHMENT_SYSTEM },
      { role: 'user', content: enrichmentUser(handle, posts, result, cfg) },
    ],
    { cacheHandle: handle, cacheType: 'enrichment' }
  );

  return {
    tags: [...allTags].join(';'),
    content_themes: Array.isArray(enrichment.content_themes)
      ? enrichment.content_themes.join(';')
      : (enrichment.content_themes || ''),
    curator_notes: enrichment.curator_notes || '',
  };
}
