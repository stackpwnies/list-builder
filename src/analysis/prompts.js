export const BIO_ANALYSIS_SYSTEM = `You are a data extraction AI. Analyze TikTok user profiles. Return ONLY valid JSON: { "email": string or null, "country": "US" or "GB" etc ISO 3166-1 alpha-2 or null, "gender": "male" or "female" or "unknown", "birth_year": { "min": number or null, "max": number or null }, "confidence": { "email": 0-1, "country": 0-1, "gender": 0-1, "birth_year": 0-1 } }. Rules: Email - look for email patterns. Country - infer from location mentions, area codes, language. Gender - infer from name, pronouns, bio content. Birth year - estimate from graduation year mentions, sorority references, college mentions, age mentions. A college student in 2025 is typically born 2002-2006. A recent grad is typically born 1999-2003.`;

export function bioAnalysisUser(handle, bio, nickname) {
  return `Username: @${handle}\nBio: ${bio || 'No bio'}\nNickname: ${nickname || ''}`;
}

export const VISION_ANALYSIS_PROMPT = `Analyze this profile photo. Return ONLY valid JSON: { "gender": "male" or "female" or "unknown", "birth_year": { "min": number or null, "max": number or null }, "confidence": { "gender": 0-1, "birth_year": 0-1 } }. Estimate birth year from apparent age.`;

export const FULL_INFERENCE_SYSTEM = `You are a location and identity inference AI. Given TikTok post captions and bio context, infer the user's location and identity. Look for: university names, sorority/fraternity hashtags, US state abbreviations, city names, area codes, regional slang, local business names, and name patterns (e.g. "Hi I'm [Name]", "[Name] | [More]", "[Name] x [Initial]", "by [Name]", or standalone name mentions). Return ONLY valid JSON: { "country": "US" or ISO 3166-1 alpha-2 code or null, "state": "US state abbreviation or null (e.g. CA, TX, NY, FL, GA, TN, etc.)", "first_name": "string or null", "last_name": "string or null", "confidence": { "country": 0-1, "state": 0-1, "name": 0-1 }, "reasoning": "brief explanation" }.`;

export function countryInferenceUser(posts, targetCountry) {
  const captions = posts.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
  return `Target country to check: ${targetCountry}\n\nPost captions:\n${captions}`;
}

export const fullInferenceUser = countryInferenceUser;

export const ENRICHMENT_SYSTEM = `You are a content analysis AI. Given a TikTok creator's recent post captions and qualification data, return ONLY valid JSON: { "content_themes": ["theme1", "theme2", ...3-5 themes max], "curator_notes": "1-2 sentence explanation of why this creator qualifies given the criteria" }.`;

export function enrichmentUser(handle, posts, result, cfg) {
  const captions = posts.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
  const criteria = [
    cfg.country ? `country=${cfg.country}` : null,
    cfg.gender ? `gender=${cfg.gender}` : null,
    `followers ${cfg.min_followers}-${cfg.max_followers}`,
    cfg.email_required ? 'email required' : null,
    cfg.birth_year_min || cfg.birth_year_max ? `birth year ${cfg.birth_year_min || '?'}-${cfg.birth_year_max || '?'}` : null,
  ].filter(Boolean).join(', ');
  return `Handle: @${handle}\nCriteria: ${criteria}\nCountry: ${result.country || 'unknown'} | Gender: ${result.gender || 'unknown'} | Followers: ${result.followers?.toLocaleString() || '?'} | Bio: ${(result.profile_bio || '').slice(0, 200)}\n\nPost captions:\n${captions}`;
}
