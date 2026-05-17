import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NRR_CACHE_PATH = join(__dirname, '..', 'public', 'data', 'nrr-cache.json');
const DATA_PATH = join(__dirname, '..', 'public', 'data', 'ipl2026.json');

const API_KEY = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f';

async function init() {
  console.log('Initializing NRR cache to May 17 standings baseline...');

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const teams = data.teams;

  // Initialize NRR cumulative baseline data
  const teamNrrData = {};
  const nrr = {};

  for (const t of teams) {
    const played = t.played;
    const runsScored = played * 160;
    const oversFaced = played * 20;
    const runsConceded = +(runsScored - (t.nrr * oversFaced)).toFixed(3);
    const oversBowled = played * 20;

    teamNrrData[t.id] = {
      runsScored,
      oversFaced,
      runsConceded,
      oversBowled,
      matchesProcessed: played,
    };
    nrr[t.id] = t.nrr;
  }

  // Fetch all currently ended matches to add to processedMatchIds
  console.log('Fetching ended matches from CricAPI series info to exclude them...');
  const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?id=${SERIES_ID}&apikey=${API_KEY}`);
  const seriesJson = await seriesRes.json();
  if (seriesJson.status !== 'success') {
    throw new Error('Could not fetch series info from CricAPI');
  }

  const processedMatchIds = seriesJson.data.matchList
    .filter(m => m.matchEnded === true)
    .map(m => m.id);

  const nrrCache = {
    processedMatchIds,
    teamNrrData,
    nrr,
    lastUpdated: new Date().toISOString(),
  };

  writeFileSync(NRR_CACHE_PATH, JSON.stringify(nrrCache, null, 2));
  console.log(`✅ NRR Cache initialized. Excluded ${processedMatchIds.length} ended matches.`);
}

init().catch(console.error);
