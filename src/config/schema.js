import { z } from 'zod';

const commaList = z.union([z.string(), z.array(z.string())]).transform(v =>
  typeof v === 'string'
    ? v.split(',').map(h => h.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean)
    : v
);

export const SearchConfigSchema = z.object({
  hashtags: commaList.default([]),
  min_followers: z.coerce.number().default(0),
  max_followers: z.coerce.number().default(999_999_999),
  birth_year_min: z.coerce.number().nullable().default(null),
  birth_year_max: z.coerce.number().nullable().default(null),
  country: z.string().nullable().default(null),
  gender: z.enum(['male', 'female']).nullable().default(null),
  email_required: z.boolean().default(true),
  target_count: z.coerce.number().default(50),
  results_per_hashtag: z.coerce.number().default(20),
  pages: z.coerce.number().default(1),
  scan_posts: z.boolean().default(false),
  output_file: z.string().default('results.json'),
  concurrency: z.coerce.number().default(5),
  update_mode: z.boolean().default(false),
  dynamic_queue: z.boolean().default(true),
  queue_fallback_enabled: z.boolean().default(true),
  enable_queue_metrics: z.boolean().default(true),
  export_prefix: z.string().optional(),
  api_rate_limit: z.coerce.number().default(250),
  sound_discovery: z.boolean().default(false),
  sounds_per_user: z.coerce.number().default(5),
  brand_seeds: z.array(z.string()).default([]),
  cross_dedup: z.boolean().default(false),
});

export const DEFAULT_CONFIG = SearchConfigSchema.parse({});
