import fs from 'fs'
import { sleep } from '../utils/rate-limit.js'
import { staggerDelay } from '../utils/rate-limit.js'
import { WriteLock } from '../utils/lock.js'
import { safeSave, saveResults, loadPreviousResults } from '../storage/results.js'
import { configureCache } from '../storage/cache.js'
import { qualify, isOnlyCountryDisqualified } from '../analysis/qualifiers.js'
import {
  checkBioExclusions, extractEmail,
  analyzeBio, analyzeVision, mergeAnalyses,
  inferCountryFromPosts, enrichFromPosts,
} from './enrichment.js'
import { DynamicQueue } from './dynamic-queue.js'

const lock = new WriteLock()

async function discoverFromSounds(posts, cfg, source, processed, queue) {
  return // disabled: low-signal, re-enable with hashtag filtering
}

export async function processUser(u, workerIndex, cfg, source, shared) {
  const { qualified, processed, allResults, pendingQueue } = shared
  await sleep(staggerDelay(workerIndex))

  const handle = u.unique_id
  const details = await source.getUserDetails(handle)
  if (!details) {
    console.log(`  SKIP ${handle}: could not fetch details`)
    return
  }

  const bio = details.bio
  const followers = details.followers

  const excluded = checkBioExclusions(bio)
  if (excluded) {
    console.log(`  SKIP ${handle}: bio contains "${excluded}"`)
    return
  }

  if (followers < cfg.min_followers || followers > cfg.max_followers) {
    console.log(`  SKIP ${handle}: ${followers.toLocaleString()} followers (need ${cfg.min_followers}-${cfg.max_followers})`)
    return
  }

  const bioEmail = extractEmail(bio)
  if (!bioEmail) {
    console.log(`  SKIP ${handle}: no email in bio`)
    return
  }

  const [bioAnalysis, visionAnalysis] = await Promise.all([
    analyzeBio(handle, bio, details.nickname),
    analyzeVision(handle, details.avatar_url),
  ])

  const { finalGender, birthYearMin, birthYearMax } = mergeAnalyses(bioAnalysis, visionAnalysis)

  const result = {
    user_id: details.user_id || u.user_id,
    handle: details.handle || handle,
    email: bioAnalysis.email || bioEmail,
    profile_photo: details.avatar_url || '',
    profile_bio: bio,
    country: bioAnalysis.country || null,
    followers,
    following: details.following || 0,
    verified: details.verified || false,
    birth_year_min: birthYearMin,
    birth_year_max: birthYearMax,
    gender: finalGender || 'unknown',
    profile_url: source.buildProfileUrl(details.handle || handle),
    bio_link: details.bio_link || null,
    confidence_email: bioAnalysis.confidence?.email || 0,
    confidence_country: bioAnalysis.confidence?.country || 0,
    confidence_gender: Math.max(visionAnalysis.confidence?.gender || 0, bioAnalysis.confidence?.gender || 0),
    confidence_birth_year: Math.max(visionAnalysis.confidence?.birth_year || 0, bioAnalysis.confidence?.birth_year || 0),
    search_hashtag: u.source_hashtag || u.source || 'unknown',
    discovered_at: new Date().toISOString(),
    country_source: 'bio',
    tags: '',
    content_themes: '',
    curator_notes: '',
  }

  let isQualified = qualify({ followers }, { ...result }, cfg)
  let postsForEnrichment = null

  if (!isQualified && cfg.scan_posts && isOnlyCountryDisqualified({ followers }, result, cfg)) {
    console.log(`  ⟳ ${result.handle} | country="${result.country}" but all other criteria pass — scanning posts...`)
    const posts = await source.getUserPosts(result.handle, 10)
    postsForEnrichment = posts
    if (posts.length) {
      const inferred = await inferCountryFromPosts(posts, cfg.country, result.handle)
      if (inferred.country === cfg.country) {
        result.country = inferred.country
        result.confidence_country = inferred.confidence?.country ?? 0
        result.country_source = 'posts'
        result.state = inferred.state || ''
        result.first_name = inferred.first_name || ''
        result.last_name = inferred.last_name || ''
        isQualified = qualify({ followers }, { ...result }, cfg)
        console.log(`    ↳ Country inferred as ${inferred.country} (conf ${(inferred.confidence * 100).toFixed(0)}%) — ${inferred.reasoning}`)
      } else {
        console.log(`    ↳ Posts suggest ${inferred.country || 'unknown'} — still disqualified`)
      }
    } else {
      console.log(`    ↳ No posts found`)
    }
  }

  if (isQualified) {
    if (!postsForEnrichment) {
      postsForEnrichment = await source.getUserPosts(result.handle, 10)
    }
    if (postsForEnrichment.length) {
      const enriched = await enrichFromPosts(result.handle, postsForEnrichment, result, cfg)
      result.tags = enriched.tags
      result.content_themes = enriched.content_themes
      result.curator_notes = enriched.curator_notes
    }

    qualified.push(result)
    console.log(`  ✓ ${result.handle} | ${followers.toLocaleString()} followers | ${result.country}${result.country_source === 'posts' ? ' (posts)' : ''} | ${result.gender} | ${result.email || 'no email'} | BY ${birthYearMin}-${birthYearMax}`)
  } else {
    console.log(`  ✗ ${result.handle} | ${followers.toLocaleString()} followers | ${result.country} | ${result.gender} | ${result.email || 'no email'} | BY ${birthYearMin}-${birthYearMax}`)
  }

  allResults.push({ ...result, qualified: isQualified })
}

function printSearchHeader(source, cfg, prev) {
  console.log(`\n=== ${source.platformName} Influencer Search ===`)
  console.log(`Hashtags: ${cfg.hashtags.length} | Pages: ${cfg.pages} | Target: ${cfg.target_count} | Followers: ${cfg.min_followers}-${cfg.max_followers} | Concurrency: ${cfg.concurrency}`)
  console.log(`Country: ${cfg.country || 'any'} | Gender: ${cfg.gender || 'any'} | Email required: ${cfg.email_required} | Scan posts: ${cfg.scan_posts}`)
  if (cfg.brand_seeds?.length) console.log(`Brand seeds: ${cfg.brand_seeds.length}`)
  if (cfg.birth_year_min || cfg.birth_year_max) console.log(`Birth year: ${cfg.birth_year_min || '?'}-${cfg.birth_year_max || '?'}`)
  console.log(`Resuming from ${cfg.output_file}: ${prev.qualified.length} qualified, ${prev.processedIds.size} previously processed`)
}

async function resolveMissingUserIds(qualified, processed, allResults, cfg, runInfo, source, lock, ownProcessedBase) {
  const missingUid = qualified.filter(q => !q.user_id && q.handle)
  if (missingUid.length === 0) return

  console.log(`\n→ Resolving user_id for ${missingUid.length} qualified users missing it...`)
  for (const q of missingUid) {
    await sleep(500)
    const resolved = await source.resolveUserId(q.handle)
    if (resolved) {
      q.user_id = resolved
      console.log(`  @${q.handle} → user_id=${resolved}`)
    } else {
      console.log(`  @${q.handle} → could not resolve user_id`)
    }
  }
  await safeSave(lock, cfg.output_file, qualified, processed, allResults, cfg, runInfo, ownProcessedBase)
}

async function finishRun(cfg, qualified, processed, allResults, runInfo) {
  console.log(`\n=== Done! ${qualified.length} qualified / ${processed.size} processed / ${allResults.length} scraped ===`)
  console.log(`Results saved to ${cfg.output_file}`)
}

function logQueueMetrics(queue, runInfo) {
  if (!queue || !(queue instanceof DynamicQueue)) return
  const metrics = queue.getMetrics()
  const elapsed = (Date.now() - new Date(runInfo.startedAt).getTime()) / 1000
  const throughput = elapsed > 0 ? (metrics.popped / elapsed).toFixed(2) : '0'
  console.log(`\n=== Queue Metrics ===`)
  console.log(`Pushed: ${metrics.pushed} | Popped: ${metrics.popped} | Peak Size: ${metrics.peakSize}`)
  console.log(`Throughput: ${throughput} users/second`)
}

async function runSearchDynamic(cfg, source, { setSigintState } = {}) {
  const DATA_DIR = './data'
  const RAW_DIR = './raw'
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(RAW_DIR, { recursive: true })

 const prev = loadPreviousResults(cfg.output_file, cfg.cross_dedup)
   configureCache({ rawDir: RAW_DIR })

   const qualified = prev.qualified
   const processed = prev.processedIds
   const ownProcessedBase = prev.ownProcessedIds || new Set()
   const allResults = prev.allResults
   const runInfo = { previousRuns: prev.previousRuns, startedAt: new Date().toISOString() }

   const queue = new DynamicQueue()

function updateSigint() {
    if (setSigintState) setSigintState({ cfg, qualified, processed, allResults, runInfo, queue, ownProcessedBase })
  }
  updateSigint()

   printSearchHeader(source, cfg, prev)
   if (cfg.enable_queue_metrics) console.log('Queue mode: dynamic')

await resolveMissingUserIds(qualified, processed, allResults, cfg, runInfo, source, lock, ownProcessedBase)
   updateSigint()

   let seedingDone = false

   async function seedQueue() {
    for (const hashtag of cfg.hashtags) {
      if (qualified.length >= cfg.target_count) break
      const users = await source.searchHashtags([hashtag], cfg.results_per_hashtag, cfg.pages)
      const newUsers = users.filter(u => !processed.has(u.user_id))
      queue.pushMany(newUsers)
      console.log(`  #${hashtag}: ${users.length} found, ${users.length - newUsers.length} already processed, ${newUsers.length} queued`)
    }

    for (const seed of cfg.brand_seeds || []) {
      if (qualified.length >= cfg.target_count) break
      const users = await source.searchHashtags([seed], cfg.results_per_hashtag, cfg.pages)
      const newUsers = users.filter(u => !processed.has(u.user_id))
      queue.pushMany(newUsers)
      console.log(`  🔖 "${seed}": ${users.length} found, ${users.length - newUsers.length} already processed, ${newUsers.length} queued`)
    }

    seedingDone = true
    queue.finish()
    console.log(`\n  Seeding complete. ${queue.size} users still in queue.`)
  }

  const shared = { qualified, processed, allResults, pendingQueue: queue }
  let saveCounter = 0

  async function runWorker(workerIndex) {
    while (qualified.length < cfg.target_count) {
      const u = await queue.pop()
      if (!u) break
      if (!u.user_id || processed.has(u.user_id)) continue
      processed.add(u.user_id)

      try {
        await processUser(u, workerIndex, cfg, source, shared)
        saveCounter++
        if (saveCounter >= cfg.concurrency) {
          saveCounter = 0
          await safeSave(lock, cfg.output_file, qualified, processed, allResults, cfg, runInfo, ownProcessedBase)
          updateSigint()
        }
        if (cfg.enable_queue_metrics && processed.size % 10 === 0) {
          const metrics = queue.getMetrics()
          console.log(`  [Metrics] Queue: ${metrics.currentSize} pending | Processed: ${processed.size} | Qualified: ${qualified.length}/${cfg.target_count}`)
        }
      } catch (e) {
        console.error(`  ERROR ${u.unique_id}: ${e.message}`)
      }
    }
  }

  const workerCount = cfg.concurrency
  const workers = Array(workerCount).fill(null).map((_, i) => runWorker(i))
  await Promise.all([seedQueue(), ...workers])

await safeSave(lock, cfg.output_file, qualified, processed, allResults, cfg, runInfo, ownProcessedBase)

  if (cfg.enable_queue_metrics) logQueueMetrics(queue, runInfo)
   await finishRun(cfg, qualified, processed, allResults, runInfo)
}

async function runSearchLegacy(cfg, source, { setSigintState } = {}) {
  const DATA_DIR = './data'
  const RAW_DIR = './raw'
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(RAW_DIR, { recursive: true })

const prev = loadPreviousResults(cfg.output_file, cfg.cross_dedup)
   configureCache({ rawDir: RAW_DIR })

   const qualified = prev.qualified
   const processed = prev.processedIds
   const ownProcessedBase = prev.ownProcessedIds || new Set()
   const allResults = prev.allResults
   const runInfo = { previousRuns: prev.previousRuns, startedAt: new Date().toISOString() }

   const pendingQueue = []
  let seedingDone = false

  printSearchHeader(source, cfg, prev)

await resolveMissingUserIds(qualified, processed, allResults, cfg, runInfo, source, lock, ownProcessedBase)

   async function seedQueue() {
    for (const hashtag of cfg.hashtags) {
      if (qualified.length >= cfg.target_count) break
      const users = await source.searchHashtags([hashtag], cfg.results_per_hashtag, cfg.pages)
      for (const u of users) {
        if (!processed.has(u.user_id)) pendingQueue.push(u)
      }
      console.log(`  #${hashtag}: ${users.length} found, ${users.filter(u => processed.has(u.user_id)).length} already processed, ${users.filter(u => !processed.has(u.user_id)).length} queued`)
    }

    for (const seed of cfg.brand_seeds || []) {
      if (qualified.length >= cfg.target_count) break
      const users = await source.searchHashtags([seed], cfg.results_per_hashtag, cfg.pages)
      for (const u of users) {
        if (!processed.has(u.user_id)) pendingQueue.push(u)
      }
      console.log(`  🔖 "${seed}": ${users.length} found, ${users.filter(u => processed.has(u.user_id)).length} already processed, ${users.filter(u => !processed.has(u.user_id)).length} queued`)
    }

    seedingDone = true
    console.log(`\n  Seeding complete. ${pendingQueue.length} total users queued.`)
  }

  const shared = { qualified, processed, allResults, pendingQueue }
  let nextIndex = 0
  let saveCounter = 0

  async function runWorker(workerIndex) {
    while (qualified.length < cfg.target_count) {
      const idx = nextIndex++
      if (idx >= pendingQueue.length) {
        if (seedingDone) break
        await sleep(500)
        nextIndex = idx
        continue
      }
      const u = pendingQueue[idx]
      if (!u.user_id || processed.has(u.user_id)) continue
      processed.add(u.user_id)

      try {
        await processUser(u, workerIndex, cfg, source, shared)
        saveCounter++
        if (saveCounter >= cfg.concurrency) {
          saveCounter = 0
          await safeSave(lock, cfg.output_file, qualified, processed, allResults, cfg, runInfo, ownProcessedBase)
        }
      } catch (e) {
        console.error(`  ERROR ${u.unique_id}: ${e.message}`)
      }
    }
  }

  const workerCount = cfg.concurrency
  const workers = Array(workerCount).fill(null).map((_, i) => runWorker(i))
  await Promise.all([seedQueue(), ...workers])
await safeSave(lock, cfg.output_file, qualified, processed, allResults, cfg, runInfo, ownProcessedBase)

   await finishRun(cfg, qualified, processed, allResults, runInfo)
}

export async function runSearch(cfg, source, { setSigintState } = {}) {
  if (!cfg.dynamic_queue) {
    return runSearchLegacy(cfg, source, { setSigintState })
  }

  try {
    return await runSearchDynamic(cfg, source, { setSigintState })
  } catch (e) {
    if (cfg.queue_fallback_enabled) {
      console.warn(`\n[Dynamic Queue Failed] Falling back to legacy mode`)
      console.warn(`Error: ${e.message}`)
      return runSearchLegacy(cfg, source, { setSigintState })
    }
    throw e
  }
}

export async function runUpdate(cfg, source) {
  configureCache({ skipCache: true })

  const prev = loadPreviousResults(cfg.output_file, false)
  const qualified = prev.qualified
  const allResults = prev.allResults
  const runInfo = { previousRuns: prev.previousRuns, startedAt: new Date().toISOString() }

  console.log(`\n=== ${source.platformName} Influencer Update Mode ===`)
  console.log(`Updating ${qualified.length} qualified influencers`)

  const disqualified = []
  const processed = new Set()

  for (let i = 0; i < qualified.length; i++) {
    const q = qualified[i]
    const handle = q.handle
    if (!handle) continue

    console.log(`\n↻ [${i + 1}/${qualified.length}] @${handle} (${q.followers?.toLocaleString() || '?'} followers)`)

    const details = await source.getUserDetails(handle)
    if (!details) {
      console.log(`  Could not fetch details — keeping existing data`)
      continue
    }

    q.followers = details.followers
    q.following = details.following || 0
    q.verified = details.verified || false
    q.profile_photo = details.avatar_url || q.profile_photo
    q.profile_bio = details.bio || q.profile_bio
    q.bio_link = details.bio_link || q.bio_link

    const newBioEmail = extractEmail(details.bio)
    if (newBioEmail) q.email = newBioEmail

    const bioAnalysis = await analyzeBio(handle, details.bio, details.nickname)

    if (bioAnalysis.email) q.email = bioAnalysis.email
    if (bioAnalysis.country) q.country = bioAnalysis.country
    if (bioAnalysis.confidence) {
      q.confidence_email = bioAnalysis.confidence.email || q.confidence_email
      q.confidence_country = bioAnalysis.confidence.country || q.confidence_country
      q.confidence_gender = Math.max(q.confidence_gender || 0, bioAnalysis.confidence.gender || 0)
      q.confidence_birth_year = Math.max(q.confidence_birth_year || 0, bioAnalysis.confidence.birth_year || 0)
    }
    if (bioAnalysis.gender && bioAnalysis.gender !== 'unknown') q.gender = bioAnalysis.gender
    if (bioAnalysis.birth_year?.min && bioAnalysis.birth_year?.max) {
      const bioMin = bioAnalysis.birth_year.min
      const bioMax = bioAnalysis.birth_year.max
      if (q.birth_year_min && q.birth_year_max) {
        q.birth_year_min = Math.max(q.birth_year_min, bioMin)
        q.birth_year_max = Math.min(q.birth_year_max, bioMax)
      } else {
        q.birth_year_min = bioMin
        q.birth_year_max = bioMax
      }
    }

    const posts = await source.getUserPosts(handle, 10)
    if (posts.length) {
      const enriched = await enrichFromPosts(handle, posts, q, cfg)
      q.tags = enriched.tags
      q.content_themes = enriched.content_themes
      q.curator_notes = enriched.curator_notes

      if (!cfg.country || q.country !== cfg.country) {
        const inferred = await inferCountryFromPosts(posts, cfg.country, handle)
        if (inferred.country) {
          q.country = inferred.country
          q.country_source = 'posts'
          q.confidence_country = inferred.confidence?.country ?? 0
        }
        if (inferred.state) q.state = inferred.state
        if (inferred.first_name) q.first_name = inferred.first_name
        if (inferred.last_name) q.last_name = inferred.last_name
      }
    }

    const stillQualified = qualify({ followers: details.followers }, { ...q }, cfg)
    if (!stillQualified) {
      console.log(`  ✗ No longer qualified (${details.followers.toLocaleString()} followers) — moved to disqualified`)
      disqualified.push({ ...q, disqualified_reason: 'update_check' })
      qualified.splice(i, 1)
      i--
    } else {
      console.log(`  ✓ ${details.followers.toLocaleString()} followers | still qualified`)
    }

    if ((i + 1) % 5 === 0) {
      await safeSave(lock, cfg.output_file, qualified, processed, allResults, cfg, runInfo)
    }
  }

  const output = {
    summary: {
      qualifiedCount: qualified.length,
      totalProcessed: processed.size,
      totalScraped: allResults.length,
      hashtagsSearched: cfg.hashtags?.length || 0,
      pagesPerHashtag: cfg.pages,
      previousRuns: runInfo.previousRuns,
      startedAt: runInfo.startedAt,
      completedAt: new Date().toISOString(),
      updateMode: true,
    },
    config: cfg,
    qualified,
    disqualified,
    all: allResults,
    processed_ids: [...processed],
  }
  fs.writeFileSync(cfg.output_file, JSON.stringify(output, null, 2))

  console.log(`\n=== Update complete! ${qualified.length} still qualified, ${disqualified.length} disqualified ===`)
  console.log(`Results saved to ${cfg.output_file}`)
}

let _sigintState = null

export function setSigintState(state) {
  _sigintState = state
}

export function installSigintHandler() {
  process.on('SIGINT', () => {
    if (_sigintState) {
      const { cfg, qualified, processed, allResults, runInfo, queue, ownProcessedBase } = _sigintState
      if (queue && queue instanceof DynamicQueue) queue.finish()
      saveResults(cfg.output_file, qualified, processed, allResults, cfg, runInfo, ownProcessedBase)

      if (queue && cfg.enable_queue_metrics) {
        logQueueMetrics(queue, runInfo)
      }

      console.log(`\n\nInterrupted. Flushed ${qualified.length} qualified / ${processed.size} processed to ${cfg.output_file}`)
    } else {
      console.log('\nInterrupted.')
    }
    process.exit(0)
  })
}
