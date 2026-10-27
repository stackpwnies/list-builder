export const CSV_HEADERS = [
  'handle', 'email', 'followers', 'country', 'gender',
  'birth_year_min', 'birth_year_max', 'discovered_at', 'search_hashtag',
  'profile_url', 'bio_link', 'profile_bio',
 'tags', 'content_themes', 'curator_notes', 'sound_discovery',
    'confidence_country', 'confidence_gender', 'confidence_birth_year',
];

export const LUMINARY_CSV_HEADERS = [
  'id', 'Luminary ID', 'Hash ID', 'First Name', 'Last Name', 'Email',
  'Age Range', 'Total Followers', 'Tier Level', 'TikTok Followers', 'TikTok URL',
  'State', 'Country', 'Tags', 'Relevant Tags', 'Content Themes', 'Curator Notes',
  'Engagement Rate', 'Video ER', 'Instagram Followers', 'Instagram URL',
  'YouTube Followers', 'YouTube URL', 'Score', 'Vetting Approved',
  'Curator Approved', 'Move Status',
];

export function csvEscape(v) {
   const json = Array.isArray(v) ? JSON.stringify(v) : v;
   const s = String(json ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes(';')
    ? `"${s}"`
    : s;
}

const TIERS = [
  ['VIP', 5_000_000],
  ['Top', 1_000_000],
  ['Macro', 250_000],
  ['Mid', 50_000],
  ['Micro', 10_000],
  ['Nano', 0],
];

function getTier(totalFollowers) {
  return TIERS.find((_, i) => totalFollowers >= TIERS[i][1])?.[0] || 'Nano';
}

async function hashId(userId) {
  if (!userId) return '';
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(String(userId)).digest('hex').slice(0, 13);
}

export async function buildCSV(qualified, config = null) {
  const headers = LUMINARY_CSV_HEADERS;

  const formatField = (row, field) => {
    const val = row[field];
    if (val == null) return '';
    return Array.isArray(val) ? val.join(';') : String(val);
  };

  const rows = await Promise.all(qualified.map(async row => {
    const followers = row.followers || 0;
    const hashIdVal = await hashId(row.user_id);
    const tags = config?.hashtags
      ? (Array.isArray(config.hashtags)
          ? config.hashtags
          : config.hashtags.split(',').map(s => s.trim()).filter(Boolean)).join(';')
      : '';

    return headers.map(h => {
      switch (h) {
        case 'id': return '';
        case 'Luminary ID': return '';
        case 'Hash ID': return hashIdVal;
        case 'First Name': return row.first_name || (row.inferred?.confidence?.first_name || '');
        case 'Last Name': return row.last_name || (row.inferred?.confidence?.last_name || '');
        case 'Email': return row.email || '';
        case 'Age Range':
          return (row.birth_year_min && row.birth_year_max)
            ? `${row.birth_year_min}-${row.birth_year_max}`
            : '';
        case 'Total Followers': return String(followers);
        case 'Tier Level': return getTier(followers);
        case 'TikTok Followers': return String(followers);
        case 'TikTok URL': return row.profile_url || '';
        case 'State': return row.state || (row.inferred?.confidence?.state || '');
        case 'Country': return row.country || '';
        case 'Tags': return formatField(row, 'tags');
        case 'Relevant Tags': return tags;
        case 'Content Themes': return formatField(row, 'content_themes');
        case 'Curator Notes': return row.curator_notes || '';
        case 'Engagement Rate': return '';
        case 'Video ER': return '';
        case 'Instagram Followers': return '';
        case 'Instagram URL': return '';
        case 'YouTube Followers': return '';
        case 'YouTube URL': return '';
        case 'Score': return '';
        case 'Vetting Approved': return '';
        case 'Curator Approved': return '';
        case 'Move Status': return '';
        default: return '';
      }
    }).map(csvEscape).join(',');
  }));

  return [headers.join(','), ...rows].join('\n');
}

export function passesConfidence(row, threshold = 0.8) {
  if (row.confidence_country != null && row.confidence_country < threshold) return false;
  if (row.confidence_gender != null && row.confidence_gender < threshold) return false;
  if (row.confidence_birth_year != null && row.confidence_birth_year < threshold) return false;
  return true;
}
