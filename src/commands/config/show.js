import fs from 'fs';
import path from 'path';

const CONFIG_DIR = './config';

export function registerShow(program) {
  return program
    .command('show')
    .description('Show current resolved config')
    .option('--config <path>', 'Path to specific config file')
    .action((opts) => {
      if (opts.config) {
        if (!fs.existsSync(opts.config)) {
          console.error(`Config file "${opts.config}" not found.`);
          process.exit(1);
        }
        const raw = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
        console.log(JSON.stringify(raw, null, 2));
        return;
      }

      const locations = [
        path.join(CONFIG_DIR, 'search-config.json'),
        './data/search-config.json',
        './search-config.json',
      ];
      for (const p of locations) {
        if (fs.existsSync(p)) {
          const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
          console.log(JSON.stringify(raw, null, 2));
          return;
        }
      }
      console.log('No config file found. Create one with `list-builder config init`.');
    });
}
