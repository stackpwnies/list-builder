import fs from 'fs';
import path from 'path';

const CONFIG_DIR = './config';

export function registerInit(program) {
  return program
    .command('init')
    .description('Scaffold a default search config file')
    .option('--name <name>', 'Config file name', 'search-config.json')
    .action((opts) => {
      const outPath = path.join(CONFIG_DIR, opts.name);
      if (fs.existsSync(outPath)) {
        console.log(`${outPath} already exists. Edit it directly.`);
        return;
      }

      const scaffold = {
        hashtags: 'example1,example2',
        min_followers: 1000,
        max_followers: 100000,
        birth_year_min: null,
        birth_year_max: null,
        country: 'US',
        gender: null,
        email_required: true,
        target_count: 500,
        results_per_hashtag: 20,
        pages: 1,
        scan_posts: false,
        output_file: 'results.json',
        concurrency: 5,
      };

      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(scaffold, null, 2));
      console.log(`Created ${outPath}`);
    });
}
