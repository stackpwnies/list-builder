import fs from 'fs';
import path from 'path';
import { loadManifest } from '../storage/manifest.js';

const DATA_DIR = './data';

function derivePrefix(filename) {
  return filename.replace(/-results\.json$/i, '').replace(/\.json$/i, '') || 'export';
}

export function registerTally(program) {
  return program
    .command('tally')
    .description('Summarize qualified influencer counts across all result files')
    .option('--data-dir <dir>', 'Directory to scan for result JSONs', DATA_DIR)
    .action((opts) => {
      const dir = opts.dataDir;
      if (!fs.existsSync(dir)) {
        console.error(`Directory "${dir}" not found.`);
        process.exit(1);
      }

      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json') && (f.includes('results') || f.includes('result')))
        .sort();

      if (!files.length) {
        console.log(`No result files found in ${dir}/`);
        return;
      }

      const seenHandles = new Set();
      const rows = [];
      let missingManifests = 0;

      for (const f of files) {
        const fp = path.join(dir, f);
        try {
          const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
          const qualified = raw.qualified || [];
          const all = raw.all || [];
          const summary = raw.summary || {};
          for (const q of qualified) seenHandles.add(q.handle);

          const prefix = derivePrefix(f);
          const manifest = loadManifest(prefix);
          let exported = '—';
          let pending = '—';

          if (manifest && manifest.exported_user_ids) {
            const exportedIds = new Set(manifest.exported_user_ids);
            const expCount = qualified.filter(q => q.user_id && exportedIds.has(q.user_id)).length;
            exported = expCount;
            pending = qualified.length - expCount;
          } else {
            missingManifests++;
          }

          rows.push({
            File: f,
            Qualified: qualified.length,
            Exported: exported,
            Pending: pending,
            'Total Scraped': all.length,
            'Last Run': summary.completedAt
              ? new Date(summary.completedAt).toISOString().slice(0, 10)
              : 'unknown',
          });
        } catch {
          rows.push({ File: f, Qualified: 0, Exported: '—', Pending: '—', 'Total Scraped': 0, 'Last Run': 'error' });
        }
      }

      console.table(rows);

      const totalQualified = rows.reduce((s, r) => s + r.Qualified, 0);
      const totalExported = rows.reduce((s, r) => s + (typeof r.Exported === 'number' ? r.Exported : 0), 0);
      const totalPending = rows.reduce((s, r) => s + (typeof r.Pending === 'number' ? r.Pending : 0), 0);
      console.log(`  TOTAL: ${totalQualified} qualified | ${totalExported} exported | ${totalPending} pending | ${seenHandles.size} unique\n`);

      if (missingManifests > 0) {
        console.log(`  ${missingManifests} file${missingManifests > 1 ? 's have' : ' has'} no manifest — run "export csv --sync" to track exports\n`);
      }
    });
}
