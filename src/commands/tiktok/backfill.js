import { Command } from 'commander';
import { runBackfill } from './backfill-engine.js';
import { installSigintHandler } from '../../pipeline/runner.js';

export function registerBackfill(program) {
  return program
    .command('backfill')
    .description('Repopulate missing first_name, last_name, state from post captions')
    .option('--output <file>', 'Path to result JSON file (required if not using --config)')
    .option('--config <path>', 'Path to config JSON for country context')
    .option('--pages <n>', 'Posts pages per influencer (default: 3)', v => parseInt(v))
    .option('--dry-run', 'Show diffs without writing')
    .option('--min-conf <n>', 'Minimum inference confidence to update (default: 0.7)', v => parseFloat(v))
    .option('--force', 'Skip confidence check, update regardless')
    .action(async (opts) => {
      installSigintHandler();

      if (!opts.output) {
        console.error('Required: --output <file> or --config <path> with output_file');
        process.exit(1);
      }

      await runBackfill(opts);
    });
}
