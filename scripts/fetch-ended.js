import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NRR_CACHE_PATH = join(__dirname, '..', 'public', 'data', 'nrr-cache.json');

const API_KEY = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f';

async function repopulate() {
  console.log('Fetching ended matches from CricAPI series info...');
  const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?id=${SERIES_ID}&apikey=${API_KEY}`);
  const seriesJson = await seriesRes.json();
  if (seriesJson.status !== 'success') {
    throw new Error('Could not fetch series info from CricAPI');
  }

  const endedMatchIds = seriesJson.data.matchList
    .filter(m => m.matchEnded === true)
    .map(m => m.id);

  console.log(`Found ${endedMatchIds.length} ended matches.`);

  const nrrCache = JSON.parse(readFileSync(NRR_CACHE_PATH, 'utf-8'));
  nrrCache.processedMatchIds = endedMatchIds;
  nrrCache.lastUpdated = new Date().toISOString();

  writeFileSync(NRR_CACHE_PATH, JSON.stringify(nrrCache, null, 2));
  console.log(`✅ NRR Cache updated with ${endedMatchIds.length} processed match IDs.`);
}

repopulate().catch(console.error);
