# list-builder

Influencer list builder CLI — search, qualify, and export creator lists from TikTok (and more).

Powered by [Bun](https://bun.sh).

## Quick Start

```bash
bun install

# Run a search
bun src/cli.js tiktok search --config college_lifestyle_search.json

# With CLI flags
bun src/cli.js tiktok search --hashtags homecooking,dinnerideas --country US --email-required --min-followers 1000 --max-followers 100000 --target 500 --depth 2 --scan-posts

# Update existing results
bun src/cli.js tiktok update --config search-config.json

# Look up a single user
bun src/cli.js tiktok user sarahleannmakeup
```

## Commands

```
list-builder tiktok search          Search TikTok by hashtags, qualify, and export creators
list-builder tiktok update          Refresh existing qualified influencers (skip search)
list-builder tiktok user <handle>   Show details for a TikTok user
list-builder export csv [files...]  Export results to CSV with confidence filtering
list-builder tally                  Summarize qualified influencer counts across all result files
list-builder config show            Show current resolved config
list-builder config init            Scaffold a default search config file
```

## Configuration

Config files live in `config/`. Pass a specific file with `--config`, or the CLI searches `config/search-config.json` → `data/search-config.json` → `./search-config.json` by default.

```json
{
  "hashtags": "homecooking,dinnerideas,easyrecipes",
  "min_followers": 1000,
  "max_followers": 100000,
  "birth_year_min": null,
  "birth_year_max": null,
  "country": "US",
  "gender": null,
  "email_required": true,
  "target_count": 500,
  "results_per_hashtag": 20,
  "pages": 3,
  "depth": 2,
  "scan_posts": true,
  "output_file": "results.json",
  "concurrency": 5
}
```

`hashtags` can be a comma-separated string or an array. CLI flags override config file values.

## Environment Variables

Secrets are read from the environment (Bun loads `.env` automatically):

```env
RAPIDAPI_KEY=...
RAPIDAPI_HOST=tiktok-scraper7.p.rapidapi.com
AI_API_KEY=...
AI_BASE_URL=https://api.kilo.ai/api/gateway/v1/chat/completions
AI_MODEL=google/gemini-2.0-flash-001
```

## Search Options

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to config JSON file | auto-discovered |
| `--hashtags <tags>` | Comma-separated hashtags | (config file) |
| `--min-followers <n>` | Minimum follower count | 0 |
| `--max-followers <n>` | Maximum follower count | 999M |
| `--country <code>` | ISO 3166-1 alpha-2 country code | any |
| `--gender <g>` | Gender filter (male/female) | any |
| `--email-required` | Require email in bio | true |
| `--birth-year-min <n>` | Earliest birth year | any |
| `--birth-year-max <n>` | Latest birth year | any |
| `--target <n>` | Stop after N qualified results | 50 |
| `--per-hashtag <n>` | Results per hashtag per page | 20 |
| `--pages <n>` | Search pages per hashtag | 1 |
| `--depth <n>` | Graph expansion depth (0=hashtags only) | 1 |
| `--scan-posts` | Infer country from post captions | false |
| `--concurrency <n>` | Parallel workers for user processing | 5 |
| `--output <file>` | Output JSON file path (relative to data/) | results.json |

## Pipeline

1. **Hashtag search** — Searches TikTok videos by hashtag via RapidAPI, extracts unique authors
2. **Profile fetch** — Gets full user details (bio, stats, avatar)
3. **Pre-filter** — Skips bios with exclusion words, outside follower range, or missing email
4. **AI analysis** — Parallel LLM calls for bio parsing + profile photo vision
5. **Qualification** — Checks followers, country, gender, email, birth year against config
6. **Post-scan rescue** (`--scan-posts`) — Infers country from post captions when it's the only failing criterion
7. **Enrichment** — Extracts tags, content themes, curator notes from recent posts
8. **Graph expansion** (`--depth`) — Fetches following lists of qualified influencers, adds new users to queue

## Data Directory

```
config/          Search config JSON files
data/            Results JSON + CSV output
raw/             Cached API/LLM responses per handle
```

### Raw Cache Structure

```
raw/<handle>/
  user_info.json        TikTok API response
  bio_analysis.json     LLM bio extraction
  vision_analysis.json  LLM profile photo analysis
  posts.json            TikTok post captions
  posts_country.json    LLM country inference from posts
  enrichment.json       LLM tags/themes/curator notes
```

Cached responses are reused on re-runs to save API/LLM credits. The `update` command bypasses the cache to fetch fresh data.

## Tally

```
list-builder tally
```

Scans all `*results*.json` in `data/` and prints a summary table with per-file qualified counts, deduplication across files, and last run dates.

## CSV Export

```
list-builder export csv
list-builder export csv --confidence 0.6
list-builder export csv data/search-results.json --output-dir /tmp/
```

Filters by confidence threshold and writes one CSV per input file. All field values are collapsed to single lines (newlines in bios replaced with spaces).

## Idempotent Resume

Every run loads previous results and continues where it left off — qualified results are preserved, processed user IDs are tracked, following lists are not re-fetched. Ctrl+C triggers a graceful shutdown that flushes all results to disk.

## APIs

| API | Purpose |
|-----|---------|
| **RapidAPI TikTok Scraper7** | Hashtag search, user info, following lists, posts |
| **Kilo AI Gateway** | LLM calls for bio analysis, photo vision, location inference |

## Adding a New Source (e.g. Instagram)

1. Create `src/sources/instagram/index.js` extending `SourceAdapter` from `src/sources/types.js`
2. Implement `searchHashtags`, `getUserDetails`, `getUserPosts`, `getFollowing`, `resolveUserId`
3. Create `src/commands/instagram/` with search/update/user command handlers
4. Register the new subcommand in `src/cli.js`

The pipeline runner (`src/pipeline/runner.js`) is source-agnostic — it takes any `SourceAdapter` instance.

## Architecture

```
src/
  cli.js                  Commander entry point
  commands/               CLI command handlers (thin wrappers)
    tiktok/               TikTok-specific commands
    export/               CSV export
    config/               Config management
    tally.js              Results summary
  sources/                Platform adapters
    types.js              SourceAdapter base class
    tiktok/               TikTok adapter (API + transforms)
    instagram/            Future placeholder
  analysis/               AI/LLM client + prompts + qualification logic
  pipeline/               Worker pool, queue, enrichment orchestration
  storage/                Cache, results JSON, CSV generation
  config/                 Zod schema + config loader
  utils/                  HTTP client, write lock, rate limiting
```
