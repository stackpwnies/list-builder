# AGENTS.md

Runtime: Bun. No build step. All source is plain ESM JavaScript.

## Commands

```bash
bun src/cli.js tiktok search --config <path>   # run a search (use --help for all flags)
bun src/cli.js tiktok update --config <path>    # refresh existing qualified influencers
bun src/cli.js tiktok user <handle>             # show user details
bun src/cli.js tally                             # summarize qualified counts across data/*.json
bun src/cli.js export csv [files...]             # export to CSV (--confidence 0-1, default 0.8)
bun src/cli.js config show [--config <path>]     # print resolved config
bun src/cli.js config init [--name foo.json]     # scaffold config (writes to config/)
bun src/cli.js benchmark --hashtags food --target 20 --mode both  # compare queue modes
```

Shortcuts: `bun start` = `bun src/cli.js`, `bun run dev` = `bun --watch src/cli.js`.

## Env vars (required at runtime)

Read by `src/sources/tiktok/api.js` and `src/analysis/ai-client.js`. Bun loads `.env` natively.

```
RAPIDAPI_KEY, RAPIDAPI_HOST     — TikTok scraper API (RapidAPI)
RAPIDAPI_RPM                    — Rate limit ceiling (default: 250, RapidAPI Pro cap is 300)
AI_API_KEY, AI_BASE_URL, AI_MODEL — LLM gateway for bio/vision/enrichment (Kilo)
```

## Config loading order

1. `--config <path>` — exact path, no search, errors if missing
2. Auto-discover: `config/search-config.json` → `data/search-config.json` → `./search-config.json`

Existing config files live at the project root (`search-config.json`, `college_lifestyle_search.json`, `postgrad-corporate-search.json`). The `config/` dir is for new ones via `config init`.

## Architecture

```
src/cli.js                     Commander entry, registers all subcommands
src/commands/<source>/         Thin handlers — parse flags, call pipeline, print output
src/sources/types.js           SourceAdapter base class (the plugin interface)
src/sources/tiktok/            api.js (HTTP + rate limiter + API error guard), transforms.js (normalize), index.js (adapter)
src/analysis/                  ai-client.js, prompts.js, qualifiers.js
src/pipeline/runner.js         Worker pool, queue, SIGINT flush. Takes any SourceAdapter.
src/pipeline/dynamic-queue.js  Async queue for real-time worker consumption (default).
src/pipeline/enrichment.js     Bio analysis, vision, country inference, tags/themes
src/storage/                   cache.js, results.js, csv.js
src/config/                    schema.js (Zod), loader.js
src/utils/                     http.js (fetch + retry with Retry-After), lock.js, rate-limit.js (stagger + sliding window RateLimiter)
```

**Adding a source** (e.g. Instagram): implement `SourceAdapter` in `src/sources/<name>/`, create `src/commands/<name>/`, register in `cli.js`. Pipeline is source-agnostic.

## Key patterns

- **SourceAdapter** methods: `searchHashtags`, `getUserDetails`, `getUserPosts`, `getFollowing`, `resolveUserId`, `platformName`, `buildProfileUrl`
- **Rate limiting**: `RateLimiter` in `src/utils/rate-limit.js` — sliding window that gates all TikTok API calls via `tiktokRateLimiter.acquire()`. Default 250 req/min (set via `RAPIDAPI_RPM` env var or `api_rate_limit` config field). Logs throttling events to console.
- **API error guard**: `isApiError()` in `src/sources/tiktok/api.js` — catches TikTok API error responses (e.g. `{code: -1, msg: "unique_id is invalid"}`) before they get cached as broken data. Returns `null` instead.
- **AI client retry**: `aiChat()` in `src/analysis/ai-client.js` uses `retryFetch` with 429 retry (3 attempts, 3s base delay). Handles transient rate limits from the LLM gateway.
- **Raw cache**: `raw/<handle>/<type>.json` — API/LLM responses cached, reused on re-run. Update mode bypasses cache (`skipCache: true`).
- **SIGINT**: `installSigintHandler()` + `setSigintState()` in runner.js — flushes results on Ctrl+C. Commands that run the pipeline must call both.
- **CSV output**: newlines in field values replaced with spaces — one row per line always.
- **Tally**: `bun src/cli.js tally` renders a `console.table()` with qualified/exported/pending counts per result file. Cross-references manifests for export tracking.
- **Config validation**: Zod schema in `src/config/schema.js`. Invalid config prints field-level errors and exits.
- **Dynamic queue**: `DynamicQueue` in `src/pipeline/dynamic-queue.js` — async push/pop with backpressure, metrics tracking. Default enabled (`dynamic_queue: true`). Falls back to legacy static array on error when `queue_fallback_enabled: true`.
- **Queue metrics**: When `enable_queue_metrics: true`, logs queue size, throughput (users/s), and peak size. Also printed on SIGINT and completion.

## Data paths

- `config/` — search configs (new)
- Root `*.json` — existing search configs (legacy location, still used)
- `data/` — result JSONs + CSV output
- `raw/` — cached API/LLM responses per handle

**Never overwrite existing configs.** Use throwaway names for testing.

## Legacy files

`tiktok-search.mjs` and `export-csv.mjs` are the pre-refactor monoliths. Do not edit — they will be deleted once the CLI is confirmed stable.

## Conventions

- ESM, `"type": "module"`, no TypeScript
- Two deps only: `commander`, `zod`
- No comments in code unless asked
- No linter configured — match existing style (2-space indent, no semicolons)
