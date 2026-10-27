import fs from 'fs';
import path from 'path';
import { SearchConfigSchema } from './schema.js';

const DATA_DIR = './data';
const CONFIG_DIR = './config';

const DEFAULT_SEARCH_PATHS = [
  path.join(CONFIG_DIR, 'search-config.json'),
  path.join(DATA_DIR, 'search-config.json'),
  './search-config.json',
];

export function resolveOutput(p) {
  if (path.isAbsolute(p)) return p;
  return path.join(DATA_DIR, p);
}

export function loadConfigFromFile(filePath) {
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Loaded config from ${filePath}`);
    return raw;
  }
  return null;
}

function findDefaultConfig() {
  for (const p of DEFAULT_SEARCH_PATHS) {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      console.log(`Loaded config from ${p}`);
      return raw;
    }
  }
  return null;
}

export function mergeCliFlags(config, flags) {
  if (flags.hashtags) config.hashtags = flags.hashtags;
  if (flags.minFollowers !== undefined) config.min_followers = flags.minFollowers;
  if (flags.maxFollowers !== undefined) config.max_followers = flags.maxFollowers;
  if (flags.country) config.country = flags.country.toUpperCase();
  if (flags.gender) config.gender = flags.gender.toLowerCase();
  if (flags.emailRequired) config.email_required = true;
  if (flags.birthYearMin !== undefined) config.birth_year_min = flags.birthYearMin;
  if (flags.birthYearMax !== undefined) config.birth_year_max = flags.birthYearMax;
  if (flags.target !== undefined) config.target_count = flags.target;
  if (flags.perHashtag !== undefined) config.results_per_hashtag = flags.perHashtag;
  if (flags.pages !== undefined) config.pages = flags.pages;
  if (flags.scanPosts) config.scan_posts = true;
  if (flags.concurrency !== undefined) config.concurrency = flags.concurrency;
  if (flags.output) config.output_file = flags.output;
  if (flags.update) config.update_mode = true;
  return config;
}

export function loadConfig(flags = {}) {
  let raw = {};
  const configFile = flags.config;

  if (configFile) {
    const fromFile = loadConfigFromFile(configFile);
    if (fromFile) {
      raw = fromFile;
    } else {
      console.error(`Config file "${configFile}" not found.`);
      process.exit(1);
    }
  } else {
    const found = findDefaultConfig();
    if (found) raw = found;
  }

  raw = mergeCliFlags(raw, flags);

  const parsed = SearchConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('Invalid config:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const cfg = parsed.data;
  cfg.output_file = resolveOutput(cfg.output_file);

  return cfg;
}
