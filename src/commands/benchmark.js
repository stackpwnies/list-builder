import { installSigintHandler, setSigintState, runSearch } from '../pipeline/runner.js'
import { loadConfig } from '../config/loader.js'
import { TikTokSource } from '../sources/tiktok/index.js'
import fs from 'fs'

export function registerBenchmark(program) {
  return program
    .command('benchmark')
    .description('Compare dynamic vs legacy queue performance')
    .option('--config <path>', 'Path to config JSON file')
    .option('--hashtags <tags>', 'Comma-separated hashtags')
    .option('--target <n>', 'Stop after N qualified results', v => parseInt(v))
    .option('--runs <n>', 'Number of comparison runs', v => parseInt(v))
    .option('--mode <mode>', 'Queue mode: dynamic|legacy|both')
    .action(async (opts) => {
      installSigintHandler()

      const modes = opts.mode === 'both' ? ['legacy', 'dynamic'] : [opts.mode || 'dynamic']
      const runs = opts.runs || 1

      console.log(`\n=== Queue Benchmark ===`)
      console.log(`Modes: ${modes.join(' + ')} | Runs: ${runs}`)

      const results = {}

      for (const mode of modes) {
        const modeResults = []

        for (let i = 0; i < runs; i++) {
          console.log(`\n--- Run ${i + 1}/${runs}: ${mode} mode ---`)

          const cfg = loadConfig({
            config: opts.config,
            hashtags: opts.hashtags,
            target: opts.target,
          })

          cfg.dynamic_queue = mode === 'dynamic'
          cfg.enable_queue_metrics = true
          cfg.output_file = `data/bench-${mode}-run${i + 1}.json`

          const source = new TikTokSource()
          const startTime = Date.now()

          await runSearch(cfg, source, { setSigintState })

          const elapsed = Date.now() - startTime
          const usersProcessed = cfg.target_count || 50
          const throughput = elapsed > 0 ? (usersProcessed / (elapsed / 1000)).toFixed(2) : '0'

          modeResults.push({ elapsed, throughput: parseFloat(throughput) })
          console.log(`Elapsed: ${(elapsed / 1000).toFixed(2)}s | Throughput: ${throughput} users/s`)
        }

        const avgElapsed = modeResults.reduce((s, r) => s + r.elapsed, 0) / runs
        const avgThroughput = modeResults.reduce((s, r) => s + r.throughput, 0) / runs

        results[mode] = {
          avgElapsed: avgElapsed.toFixed(0),
          avgThroughput: avgThroughput.toFixed(2),
          minElapsed: Math.min(...modeResults.map(r => r.elapsed)).toFixed(0),
          maxElapsed: Math.max(...modeResults.map(r => r.elapsed)).toFixed(0),
        }
      }

      console.log(`\n=== Benchmark Results ===`)
      for (const [mode, stats] of Object.entries(results)) {
        console.log(`\n${mode.toUpperCase()}:`)
        console.log(`  Avg elapsed: ${(stats.avgElapsed / 1000).toFixed(2)}s`)
        console.log(`  Avg throughput: ${stats.avgThroughput} users/s`)
        console.log(`  Min elapsed: ${(stats.minElapsed / 1000).toFixed(2)}s`)
        console.log(`  Max elapsed: ${(stats.maxElapsed / 1000).toFixed(2)}s`)
      }

      if (results.legacy && results.dynamic) {
        const speedup = (parseFloat(results.dynamic.avgThroughput) / parseFloat(results.legacy.avgThroughput)).toFixed(2)
        console.log(`\nDynamic queue is ${speedup}x faster`)
      }

      for (const mode of modes) {
        for (let i = 0; i < runs; i++) {
          const f = `data/bench-${mode}-run${i + 1}.json`
          if (fs.existsSync(f)) fs.unlinkSync(f)
          const csv = f.replace('.json', '.csv')
          if (fs.existsSync(csv)) fs.unlinkSync(csv)
        }
      }
    })
}
