import fs from 'fs'
import path from 'path'
import { buildCSV, passesConfidence } from '../../storage/csv.js'
import { loadConfig } from '../../config/loader.js'
import { derivePrefix, syncManifest, resetManifest, exportBatch } from '../../storage/manifest.js'

const DATA_DIR = './data'

export function registerCsv(program) {
  return program
    .command('csv [files...]')
    .description('Export results to CSV with dedup and batch tracking')
    .option('--config <path>', 'Path to config JSON file (enables batch mode)')
    .option('--confidence <n>', 'Minimum confidence threshold (0-1)', parseFloat, 0.8)
    .option('--limit <n>', 'Max influencers per batch', v => parseInt(v))
    .option('--sync', 'Rebuild manifest from existing batch CSVs')
    .option('--reset', 'Clear manifest (keep CSVs)')
    .option('--output-dir <dir>', 'Output directory for CSV files', DATA_DIR)
    .action(async (files, opts) => {
      if (opts.config) {
        const cfg = loadConfig({ config: opts.config })
        const prefix = derivePrefix(cfg)

        if (opts.sync) {
          syncManifest(prefix, cfg)
          return
        }

        if (opts.reset) {
          resetManifest(prefix)
          console.log(`Manifest cleared for "${prefix}". Next export will include all qualifying influencers.`)
          return
        }

        exportBatch(prefix, cfg, { limit: opts.limit, confidence: opts.confidence })
        return
      }

      if (!files.length) {
        if (fs.existsSync(DATA_DIR)) {
          files = fs.readdirSync(DATA_DIR)
            .filter(f => f.includes('results') && f.endsWith('.json'))
            .map(f => path.join(DATA_DIR, f))
        }
      }

      if (!files.length) {
        console.error('No result files found. Pass file paths or use --config.')
        process.exit(1)
      }

      let grandTotal = 0

      for (const file of files) {
        const fp = path.resolve(file)
        if (!fs.existsSync(fp)) {
          console.log(`SKIP ${file}: not found`)
          continue
        }

        const raw = JSON.parse(fs.readFileSync(fp, 'utf8'))
        const qualified = raw.qualified || []
        const rows = qualified.filter(r => passesConfidence(r, opts.confidence))

        const config = raw.config || null
        const csv = await buildCSV(rows, config)
        const baseName = path.basename(file, '.json')
        const outFile = path.join(opts.outputDir, `${baseName}.csv`)
        fs.mkdirSync(opts.outputDir, { recursive: true })
        fs.writeFileSync(outFile, csv)

        const dropped = qualified.length - rows.length
        console.log(`${path.basename(file)}: ${rows.length}/${qualified.length} passed confidence ≥${(opts.confidence * 100).toFixed(0)}% (${dropped} below threshold) → ${outFile}`)
        grandTotal += rows.length
      }

      console.log(`\nTotal: ${grandTotal} across ${files.length} files`)
    })
}
