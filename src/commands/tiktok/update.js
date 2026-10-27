import { loadConfig } from '../../config/loader.js';
import { TikTokSource } from '../../sources/tiktok/index.js';
import { runUpdate, installSigintHandler } from '../../pipeline/runner.js';

export function registerUpdate(program) {
  return program
    .command('update')
    .description('Refresh existing qualified influencers (skip search)')
    .option('--config <path>', 'Path to config JSON file')
    .option('--min-followers <n>', 'Minimum follower count', v => parseInt(v))
    .option('--max-followers <n>', 'Maximum follower count', v => parseInt(v))
    .option('--country <code>', 'ISO 3166-1 alpha-2 country code')
    .option('--gender <g>', 'Gender filter (male/female)')
    .option('--email-required', 'Require email in bio')
    .option('--birth-year-min <n>', 'Earliest birth year', v => parseInt(v))
    .option('--birth-year-max <n>', 'Latest birth year', v => parseInt(v))
    .option('--output <file>', 'Output JSON file path')
    .action(async (opts) => {
      installSigintHandler();

      const cfg = loadConfig({
        config: opts.config,
        minFollowers: opts.minFollowers,
        maxFollowers: opts.maxFollowers,
        country: opts.country,
        gender: opts.gender,
        emailRequired: opts.emailRequired,
        birthYearMin: opts.birthYearMin,
        birthYearMax: opts.birthYearMax,
        output: opts.output,
        update: true,
      });

      const source = new TikTokSource();
      await runUpdate(cfg, source);
    });
}
