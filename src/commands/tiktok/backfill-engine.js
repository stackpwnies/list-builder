import fs from 'fs';
import { TikTokSource } from '../../sources/tiktok/index.js';
import { tiktokRateLimiter } from '../../utils/rate-limit.js';
import { loadRaw, saveRaw } from '../../storage/cache.js';
import { aiChat } from '../../analysis/ai-client.js';
import { FULL_INFERENCE_SYSTEM, fullInferenceUser } from '../../analysis/prompts.js';
import { loadConfig } from '../../config/loader.js';
import { BioLinkCrawler } from '../../bio-crawler.js';

export async function runBackfill(opts) {
  const output = opts.output;
  const configPath = opts.config;
  const pages = opts.pages || 3;
  const dryRun = opts.dryRun;
  const minConf = opts.minConf != null ? opts.minConf : 0.7;
  const force = opts.force;
  const batch = opts.batch;

  const resultRaw = JSON.parse(fs.readFileSync(output, 'utf8'));
  const qualified = resultRaw.qualified;

  if (!Array.isArray(qualified)) {
    console.error(`No qualified array found in ${output}`);
    process.exit(1);
  }

  const cfg = configPath ? loadConfig({ config: configPath }) : null;
  const targetCountry = cfg?.country || 'US';

  const source = new TikTokSource();
   const stats = {
     total: qualified.length, updated: 0, skipped: 0, noPosts: 0, apiCalls: 0, failed: 0,
     cached: 0, inferred: 0, bioCrawled: 0, bioFailed: 0, bioNameExtracted: 0,
     bioStateExtracted: 0, bioComplete: 0,
   };

  const toProcess = [];
  for (let i = 0; i < qualified.length; i++) {
    const entry = qualified[i];
    if (!entry.handle) continue;
    const hasName = entry.first_name && entry.first_name.trim() !== '';
    const hasLastName = entry.last_name && entry.last_name.trim() !== '';
    const hasState = entry.state && entry.state.trim() !== '';
    if (hasName && hasLastName && hasState) {
      stats.skipped++;
      continue;
    }
    if (!toProcess.length || i === qualified.length - 1 || toProcess.length < (batch || 100)) {
      toProcess.push({ index: i, entry });
    }
  }

  console.log(`\n=== TikTok Backfill ===`);
  console.log(`File: ${output} | Total qualified: ${stats.total}`);
  console.log(`To process: ${toProcess.length} | Mode: ${dryRun ? 'dry-run' : 'live'}`);
  console.log(`Config: ${configPath || 'none (using US)'}`);
  console.log(`Min confidence: ${minConf} | Batch: ${batch || 'all'}\n`);

  for (let i = 0; i < toProcess.length; i++) {
    const { index, entry } = toProcess[i];
    const handle = entry.handle;
    const progress = `${i + 1}/${toProcess.length}`;

    // Check raw cache first
    let posts = loadRaw(handle, 'posts');
    let fromCache = true;

    if (!posts || !posts.length) {
      try {
        await tiktokRateLimiter.acquire();
        posts = await source.getUserPosts(handle, 10 * pages);
        fromCache = false;
        stats.apiCalls += pages;
      } catch (e) {
        stats.failed++;
        continue;
      }
    } else {
      stats.cached++;
    }

    if (!posts.length) {
      stats.noPosts++;
      continue;
    }

    let bioData = {};
    if (entry.bio_link) {
      try {
        const crawler = new BioLinkCrawler();
        const initialized = await crawler.initSession();
        if (initialized) {
          bioData = await crawler.crawlUrl(entry.bio_link);
          await crawler.cleanup();
        }
        stats.bioCrawled++;
      } catch {
        stats.bioFailed++;
      }
      if (bioData.name) stats.bioNameExtracted++;
      if (bioData.state) stats.bioStateExtracted++;
    }

    const stillNeedsName = !entry.first_name || !entry.last_name;
    const stillNeedsState = !entry.state;

    let inference = null;
    if (stillNeedsName || stillNeedsState) {
      try {
        const userPrompt = fullInferenceUser(posts, targetCountry);
        inference = await aiChat([
          { role: 'system', content: FULL_INFERENCE_SYSTEM },
          { role: 'user', content: userPrompt },
        ]);
        stats.inferred++;
      } catch (e) {
        stats.failed++;
        continue;
      }
    }

    let parsed = null;
    if (inference) {
      if (typeof inference === 'string') {
        try {
          const jsonStr = inference.match(/\{[\s\S]*\}/)?.[0] || inference;
          parsed = JSON.parse(jsonStr);
        } catch {
          stats.failed++;
          continue;
        }
      } else {
        parsed = inference;
      }
    }

    const updates = {};
    if (!entry.first_name && bioData.name) {
      updates.first_name = bioData.name.split(' ')[0];
    } else if (!entry.first_name && parsed?.first_name) {
      updates.first_name = parsed.first_name;
    }
    if (!entry.last_name && bioData.name) {
      const parts = bioData.name.split(' ');
      updates.last_name = parts.length > 1 ? parts.slice(1).join(' ') : '';
    } else if (!entry.last_name && parsed?.last_name) {
      updates.last_name = parsed.last_name;
    }
    if (!entry.state && bioData.state) {
      updates.state = bioData.state;
    } else if (!entry.state && parsed?.state) {
      updates.state = parsed.state;
    }

    if (Object.keys(updates).length === 0 && !force) {
      if (entry.first_name && entry.last_name && entry.state) {
        stats.bioComplete++;
      } else {
        stats.skipped++;
      }
      continue;
    }

    let parsedConf = parsed?.confidence?.name || 0;
    const shouldUpdate = force || parsedConf >= minConf;

    if (!shouldUpdate) {
      if (!dryRun) {
        stats.skipped++;
      }
      if (dryRun) {
        console.log(`  [${progress}] @${handle} — conf ${parsedConf.toFixed(2)} < ${minConf} — would skip`);
      }
      continue;
    }

    for (const [key, val] of Object.entries(updates)) {
      entry[key] = val;
    }

    if (dryRun) {
      const fields = Object.entries(updates)
        .map(([k, v]) => `    ${k}: "${v}"`)
        .join('\n');
      console.log(`  [${progress}] @${handle} — DRY-RUN: ${Object.keys(updates).length} fields updated\n${fields}\n`);
    } else {
      stats.updated++;
    }

    // Save result every 50 entries to avoid excessive writes
    if (!dryRun && (i + 1) % 50 === 0) {
      saveResult(output, resultRaw);
    }
  }

  if (!dryRun) {
    saveResult(output, resultRaw);
  }

  console.log(`\n=== Backfill complete ===`);
  console.log(`  Total qualified:   ${stats.total}`);
  console.log(`  Processed:         ${toProcess.length}`);
  console.log(`  Updated:           ${stats.updated}`);
  console.log(`  Skipped:           ${stats.skipped}`);
  console.log(`  Bio-complete:      ${stats.bioComplete}`);
  console.log(`  No posts cached:   ${stats.noPosts}`);
  console.log(`  Bio crawls:        ${stats.bioCrawled}`);
  console.log(`  Bio name found:    ${stats.bioNameExtracted}`);
  console.log(`  Bio state found:   ${stats.bioStateExtracted}`);
  console.log(`  Bio failed:        ${stats.bioFailed}`);
  console.log(`  API calls:         ${stats.apiCalls}`);
  console.log(`  Cache hits:        ${stats.cached}`);
  console.log(`  AI inferred:       ${stats.inferred}`);
  console.log(`  Failed:            ${stats.failed}`);
  if (dryRun) console.log(`\n(Dry-run mode — no files written)`);
}

function saveResult(outputPath, resultRaw) {
  const dir = outputPath.split('/').slice(0, -1).join('/');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(resultRaw, null, 2));
}
