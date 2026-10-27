import fs from 'fs'
import path from 'path'
import { buildCSV, CSV_HEADERS } from './csv.js'

const DATA_DIR = './data'

export function derivePrefix(cfg) {
  if (cfg.export_prefix) return cfg.export_prefix
  const base = path.basename(cfg.output_file)
  const prefix = base.replace(/-results\.json$/i, '').replace(/\.json$/i, '')
  return prefix || 'export'
}

function manifestPath(prefix) {
  return path.join(DATA_DIR, `${prefix}-manifest.json`)
}

function resultPath(outputFile) {
  if (path.isAbsolute(outputFile)) return outputFile
  return path.join(DATA_DIR, path.basename(outputFile))
}

export function loadManifest(prefix) {
  const mp = manifestPath(prefix)
  if (!fs.existsSync(mp)) return null
  try {
    return JSON.parse(fs.readFileSync(mp, 'utf8'))
  } catch {
    return null
  }
}

export function saveManifest(prefix, manifest) {
  const mp = manifestPath(prefix)
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2))
}

export function resetManifest(prefix) {
  const mp = manifestPath(prefix)
  if (fs.existsSync(mp)) {
    fs.writeFileSync(mp, JSON.stringify({ batches: [], exported_user_ids: [] }, null, 2))
  } else {
    saveManifest(prefix, { batches: [], exported_user_ids: [] })
  }
}

export function getExportedUserIds(prefix) {
  const manifest = loadManifest(prefix)
  if (!manifest) return new Set()
  return new Set(manifest.exported_user_ids || [])
}

export function syncManifest(prefix, cfg) {
  const rp = resultPath(cfg.output_file)
  if (!fs.existsSync(rp)) {
    console.error(`Result file not found: ${rp}`)
    process.exit(1)
  }

  const existingManifest = loadManifest(prefix)
  if (existingManifest && existingManifest.exported_user_ids?.length > 0) {
    console.log(`Manifest already exists: ${manifestPath(prefix)}`)
    console.log('Use --reset first if you want to rebuild it.')
    return
  }

  const resultData = JSON.parse(fs.readFileSync(rp, 'utf8'))
  const qualified = resultData.qualified || []
  const handleToUserId = new Map()
  for (const q of qualified) {
    if (q.handle) handleToUserId.set(q.handle, q.user_id || null)
  }

  const glob = new RegExp(`^${prefix}-batch-\\d+\\.csv$`)
  let batchFiles = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter(f => glob.test(f)).sort()
    : []

  const legacyName = `${prefix}-results.csv`
  const legacyPath = path.join(DATA_DIR, legacyName)
  if (batchFiles.length === 0 && fs.existsSync(legacyPath)) {
    const batch1Name = `${prefix}-batch-1.csv`
    const batch1Path = path.join(DATA_DIR, batch1Name)
    fs.renameSync(legacyPath, batch1Path)
    console.log(`Renamed ${legacyName} → ${batch1Name}`)
    batchFiles = [batch1Name]
  }

  if (batchFiles.length === 0) {
    console.log('No export CSVs found to sync.')
    return
  }

  const batches = []
  const exportedUserIds = new Set()

  for (const batchFile of batchFiles) {
    const bp = path.join(DATA_DIR, batchFile)
    const lines = fs.readFileSync(bp, 'utf8').trim().split('\n')
    if (lines.length < 2) continue

    const headerLine = lines[0]
    const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
    const handleIdx = headers.indexOf('handle')

    if (handleIdx === -1) {
      console.log(`  ${batchFile}: no handle column found, skipping`)
      continue
    }

    let count = 0
    let warned = 0
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      const handle = cols[handleIdx]
      if (!handle) continue

      const uid = handleToUserId.get(handle)
      if (uid) {
        exportedUserIds.add(uid)
        count++
      } else {
        warned++
      }
    }

    batches.push({
      file: batchFile,
      count,
      synced_at: new Date().toISOString(),
    })

    console.log(`  ${batchFile}: ${count} matched, ${warned} unmatched handles`)
    if (warned > 0) {
      console.log(`    ⚠ ${warned} handles in CSV could not be matched back to result file`)
    }
  }

  const manifest = {
    batches,
    exported_user_ids: [...exportedUserIds],
  }

  saveManifest(prefix, manifest)
  console.log(`\nManifest saved: ${manifestPath(prefix)}`)
  console.log(`Total synced: ${exportedUserIds.size} unique user_ids across ${batches.length} batches`)
}

export async function exportBatch(prefix, cfg, { limit, confidence }) {
  const rp = resultPath(cfg.output_file)
  if (!fs.existsSync(rp)) {
    console.error(`Result file not found: ${rp}`)
    process.exit(1)
  }

  const resultData = JSON.parse(fs.readFileSync(rp, 'utf8'))
  const qualified = resultData.qualified || []

  let filtered = qualified
  if (confidence) {
    filtered = filtered.filter(r => {
      if (r.confidence_country != null && r.confidence_country < confidence) return false
      if (r.confidence_gender != null && r.confidence_gender < confidence) return false
      if (r.confidence_birth_year != null && r.confidence_birth_year < confidence) return false
      return true
    })
  }

  const exportedIds = getExportedUserIds(prefix)
  const remaining = filtered.filter(r => {
    if (r.user_id && exportedIds.has(r.user_id)) return false
    return true
  })

  if (remaining.length === 0) {
    console.log(`0 new influencers to export (${filtered.length} total, ${exportedIds.size} already exported)`)
    return
  }

  const toExport = limit ? remaining.slice(0, limit) : remaining
  const batchNum = (loadManifest(prefix)?.batches?.length || 0) + 1
  const batchFile = `${prefix}-batch-${batchNum}.csv`
  const batchPath = path.join(DATA_DIR, batchFile)

  const csv = await buildCSV(toExport, cfg)
  fs.writeFileSync(batchPath, csv)

  const newUserIds = toExport.map(r => r.user_id).filter(Boolean)
  const manifest = loadManifest(prefix) || { batches: [], exported_user_ids: [] }
  manifest.batches.push({
    file: batchFile,
    count: toExport.length,
    exported_at: new Date().toISOString(),
  })
  manifest.exported_user_ids = [...new Set([...manifest.exported_user_ids, ...newUserIds])]
  saveManifest(prefix, manifest)

  console.log(`Exported ${toExport.length} influencers → ${batchPath}`)
  if (limit && remaining.length > limit) {
    console.log(`${remaining.length - limit} remaining for future batches`)
  }
  console.log(`Total exported across all batches: ${manifest.exported_user_ids.length}`)
}

function parseCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}
