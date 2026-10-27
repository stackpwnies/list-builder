import { loadConfig } from '../../config/loader.js';
import { TikTokSource } from '../../sources/tiktok/index.js';
import { runSearch, installSigintHandler, setSigintState } from '../../pipeline/runner.js';

export function registerSearch(program) {
  return program
    .command('search')
    .description('Search TikTok by hashtags, qualify, and export creators')
    .option('--config <path>', 'Path to config JSON file')
    .option('--hashtags <tags>', 'Comma-separated hashtags')
    .option('--min-followers <n>', 'Minimum follower count', v => parseInt(v))
    .option('--max-followers <n>', 'Maximum follower count', v => parseInt(v))
    .option('--country <code>', 'ISO 3166-1 alpha-2 country code')
    .option('--gender <g>', 'Gender filter (male/female)')
    .option('--email-required', 'Require email in bio')
    .option('--birth-year-min <n>', 'Earliest birth year', v => parseInt(v))
    .option('--birth-year-max <n>', 'Latest birth year', v => parseInt(v))
    .option('--target <n>', 'Stop after N qualified results', v => parseInt(v))
    .option('--per-hashtag <n>', 'Results per hashtag per page', v => parseInt(v))
    .option('--pages <n>', 'Search pages per hashtag', v => parseInt(v))
    .option('--scan-posts', 'Infer country from post captions')
    .option('--concurrency <n>', 'Parallel workers', v => parseInt(v))
    .option('--output <file>', 'Output JSON file path')
    .action(async (opts) => {
      installSigintHandler();

      const cfg = loadConfig({
        config: opts.config,
        hashtags: opts.hashtags,
        minFollowers: opts.minFollowers,
        maxFollowers: opts.maxFollowers,
        country: opts.country,
        gender: opts.gender,
        emailRequired: opts.emailRequired,
        birthYearMin: opts.birthYearMin,
        birthYearMax: opts.birthYearMax,
        target: opts.target,
        perHashtag: opts.perHashtag,
        pages: opts.pages,
        scanPosts: opts.scanPosts,
        concurrency: opts.concurrency,
        output: opts.output,
      });

      if (!cfg.update_mode && !cfg.hashtags.length) {
        console.error('No hashtags specified. Use --hashtags tag1,tag2 or provide a config file.');
        process.exit(1);
      }

      const source = new TikTokSource();
      await runSearch(cfg, source, { setSigintState });
    });
}
