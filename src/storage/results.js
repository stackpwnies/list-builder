import fs from 'fs';
import path from 'path';

export function loadPreviousResults(outputFile, crossDedup = false) {
   if (!fs.existsSync(outputFile)) {
     return {
       qualified: [],
       processedIds: new Set(),
       allResults: [],
       previousRuns: 0,
       ownProcessedIds: new Set(),
     };
   }
   try {
     const raw = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
     const qualified = raw.qualified || raw.results || [];
     const allResults = raw.all || [];
     const processedIds = new Set();
     for (const id of raw.processed_ids || []) {
       processedIds.add(id);
     }
     for (const r of allResults) {
       if (r.user_id) processedIds.add(r.user_id);
     }
     for (const r of qualified) {
       if (r.user_id) processedIds.add(r.user_id);
     }

     const ownProcessedIds = new Set(processedIds);

     if (crossDedup) {
       const dir = path.dirname(outputFile);
       const baseName = path.basename(outputFile);
       try {
         for (const f of fs.readdirSync(dir)) {
           if (f.endsWith('-results.json') && f !== baseName) {
             try {
               const sibling = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
               for (const id of sibling.processed_ids || []) {
                 processedIds.add(id);
               }
               for (const r of sibling.all || []) {
                 if (r.user_id) processedIds.add(r.user_id);
               }
               for (const r of sibling.qualified || []) {
                 if (r.user_id) processedIds.add(r.user_id);
               }
             } catch {}
           }
         }
       } catch {}
     }

     const previousRuns = raw.summary?.previousRuns ? raw.summary.previousRuns + 1 : 1;
     return { qualified, processedIds, allResults, previousRuns, ownProcessedIds };
   } catch {
     return {
       qualified: [],
       processedIds: new Set(),
       allResults: [],
       previousRuns: 0,
       ownProcessedIds: new Set(),
     };
   }
}

export function saveResults(outputFile, qualified, processed, allResults, cfg, runInfo, ownProcessedBase) {
   const ownIds = ownProcessedBase ? new Set(ownProcessedBase) : new Set();
   for (const r of qualified) { if (r.user_id) ownIds.add(r.user_id); }
   for (const r of allResults) { if (r.user_id) ownIds.add(r.user_id); }
   const output = {
     summary: {
       qualifiedCount: qualified.length,
       totalProcessed: processed.size,
       totalScraped: allResults.length,
       hashtagsSearched: cfg.hashtags?.length || 0,
       pagesPerHashtag: cfg.pages,
       previousRuns: runInfo.previousRuns || 1,
       startedAt: runInfo.startedAt,
       completedAt: new Date().toISOString(),
     },
     config: cfg,
     qualified,
     all: allResults,
     processed_ids: [...ownIds],
   };
   fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
}

export async function safeSave(lock, outputFile, qualified, processed, allResults, cfg, runInfo, ownProcessedBase) {
   await lock.acquire();
   try {
     saveResults(outputFile, qualified, processed, allResults, cfg, runInfo, ownProcessedBase);
   } finally {
     lock.release();
  }
}
