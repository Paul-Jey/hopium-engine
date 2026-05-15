/**
 * IPL 2026 Data Updater
 * 
 * Fetches current IPL standings from CricAPI and incrementally updates NRR
 * by fetching only NEW match scores since the last run.
 * 
 * Daily cost: ~4 API hits (1 standings + 1 series_info + 1-2 match_info)
 * 
 * Run with: node scripts/update-data.js
 * Scheduled via GitHub Actions at 12:00 AM IST daily.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'public', 'data', 'ipl2026.json');
const NRR_CACHE_PATH = join(__dirname, '..', 'public', 'data', 'nrr-cache.json');

const API_KEY = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f';

// ---- Team ID mapping ----
const SHORTNAME_TO_ID = {
  'CSK': 'csk', 'DC': 'dc', 'GT': 'gt', 'KKR': 'kkr', 'LSG': 'lsg',
  'MI': 'mi', 'PBKS': 'pbks', 'RR': 'rr', 'RCBW': 'rcb', 'RCB': 'rcb', 'SRH': 'srh',
};

const TEAMS_META = {
  pbks: { name: 'Punjab Kings', shortName: 'PBKS' },
  rcb:  { name: 'Royal Challengers Bengaluru', shortName: 'RCB' },
  srh:  { name: 'Sunrisers Hyderabad', shortName: 'SRH' },
  rr:   { name: 'Rajasthan Royals', shortName: 'RR' },
  gt:   { name: 'Gujarat Titans', shortName: 'GT' },
  csk:  { name: 'Chennai Super Kings', shortName: 'CSK' },
  dc:   { name: 'Delhi Capitals', shortName: 'DC' },
  kkr:  { name: 'Kolkata Knight Riders', shortName: 'KKR' },
  mi:   { name: 'Mumbai Indians', shortName: 'MI' },
  lsg:  { name: 'Lucknow Super Giants', shortName: 'LSG' },
};

function resolveTeamId(teamName, teamInfoList) {
  if (teamInfoList) {
    for (const info of teamInfoList) {
      if (info.name === teamName && SHORTNAME_TO_ID[info.shortname]) {
        return SHORTNAME_TO_ID[info.shortname];
      }
    }
  }
  const lower = teamName.toLowerCase();
  if (lower.includes('chennai')) return 'csk';
  if (lower.includes('delhi')) return 'dc';
  if (lower.includes('gujarat')) return 'gt';
  if (lower.includes('kolkata')) return 'kkr';
  if (lower.includes('lucknow')) return 'lsg';
  if (lower.includes('mumbai')) return 'mi';
  if (lower.includes('punjab')) return 'pbks';
  if (lower.includes('rajasthan')) return 'rr';
  if (lower.includes('bengaluru') || lower.includes('bangalore') || lower.includes('royal challengers')) return 'rcb';
  if (lower.includes('sunrisers') || lower.includes('hyderabad')) return 'srh';
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Fetch Standings ----
async function fetchPointsTable() {
  console.log('Fetching standings from CricAPI...');
  const res = await fetch(`https://api.cricapi.com/v1/series_points?id=${SERIES_ID}&apikey=${API_KEY}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.reason || 'Unknown');
  console.log(`  API hits: ${json.info?.hitsToday || '?'}/100`);

  const seen = new Set();
  return json.data.map(ts => {
    const teamId = SHORTNAME_TO_ID[ts.shortname] || null;
    if (!teamId || seen.has(teamId)) return null;
    seen.add(teamId);

    const played = parseInt(ts.matches || 0);
    const won = parseInt(ts.wins || 0);
    const lost = parseInt(ts.loss || 0);
    const nr = parseInt(ts.nr || 0);
    const ties = parseInt(ts.ties || 0);

    return {
      id: teamId,
      name: TEAMS_META[teamId]?.name || ts.teamname,
      shortName: TEAMS_META[teamId]?.shortName || ts.shortname,
      played, won, lost,
      noResult: nr + ties,
      points: (won * 2) + nr + ties,
    };
  }).filter(Boolean);
}

// ---- Incremental NRR Update ----
async function updateNRR(nrrCache) {
  console.log('Checking for new matches to update NRR...');

  // Fetch series info to get match list
  const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?id=${SERIES_ID}&apikey=${API_KEY}`);
  const seriesJson = await seriesRes.json();
  if (seriesJson.status !== 'success') {
    console.log('  ⚠️ Could not fetch series info');
    return nrrCache;
  }
  console.log(`  API hits: ${seriesJson.info?.hitsToday || '?'}/100`);

  // Find matches we haven't processed yet
  const allEnded = seriesJson.data.matchList.filter(m => m.matchEnded === true);
  const alreadyProcessed = new Set(nrrCache.processedMatchIds || []);
  const newMatches = allEnded.filter(m => !alreadyProcessed.has(m.id));

  if (newMatches.length === 0) {
    console.log('  No new matches to process. NRR is up to date.');
    return nrrCache;
  }

  console.log(`  Found ${newMatches.length} new match(es) to process.`);

  // Fetch score for each new match
  for (const match of newMatches) {
    console.log(`  Fetching: ${match.name.substring(0, 60)}...`);
    await sleep(200);

    try {
      const matchRes = await fetch(`https://api.cricapi.com/v1/match_info?id=${match.id}&apikey=${API_KEY}`);
      const matchJson = await matchRes.json();

      if (matchJson.status !== 'success' || !matchJson.data?.score?.length || matchJson.data.score.length < 2) {
        console.log('    ⚠️ No complete score data — skipping');
        nrrCache.processedMatchIds.push(match.id); // Mark as processed to avoid retry
        continue;
      }

      const data = matchJson.data;
      const scores = data.score;
      const teamInfo = data.teamInfo || [];

      const inning1Team = scores[0].inning.replace(/\s+Inning\s+\d+$/i, '').trim();
      const inning2Team = scores[1].inning.replace(/\s+Inning\s+\d+$/i, '').trim();
      const team1Id = resolveTeamId(inning1Team, teamInfo);
      const team2Id = resolveTeamId(inning2Team, teamInfo);

      if (!team1Id || !team2Id) {
        console.log(`    ⚠️ Unknown team: ${inning1Team} or ${inning2Team}`);
        nrrCache.processedMatchIds.push(match.id);
        continue;
      }

      // Parse overs properly (e.g. 19.4 -> 19 + 4/6)
      function parseOvers(o, w) {
        if (w === 10) return 20;
        const parts = o.toString().split('.');
        const overs = parseInt(parts[0]);
        const balls = parseInt(parts[1] || '0');
        return overs + (balls / 6);
      }

      const o1 = parseOvers(scores[0].o, scores[0].w);
      const o2 = parseOvers(scores[1].o, scores[1].w);

      // Accumulate NRR data
      nrrCache.teamNrrData[team1Id].runsScored += scores[0].r;
      nrrCache.teamNrrData[team1Id].oversFaced += o1;
      nrrCache.teamNrrData[team1Id].runsConceded += scores[1].r;
      nrrCache.teamNrrData[team1Id].oversBowled += o2;
      nrrCache.teamNrrData[team1Id].matchesProcessed++;

      nrrCache.teamNrrData[team2Id].runsScored += scores[1].r;
      nrrCache.teamNrrData[team2Id].oversFaced += o2;
      nrrCache.teamNrrData[team2Id].runsConceded += scores[0].r;
      nrrCache.teamNrrData[team2Id].oversBowled += o1;
      nrrCache.teamNrrData[team2Id].matchesProcessed++;

      nrrCache.processedMatchIds.push(match.id);
      console.log('    ✅');

    } catch (e) {
      console.log(`    ❌ ${e.message}`);
    }
  }

  // Recalculate NRR from accumulated data
  for (const [id, d] of Object.entries(nrrCache.teamNrrData)) {
    if (d.oversFaced > 0 && d.oversBowled > 0) {
      nrrCache.nrr[id] = +((d.runsScored / d.oversFaced) - (d.runsConceded / d.oversBowled)).toFixed(3);
    } else {
      nrrCache.nrr[id] = 0;
    }
  }

  nrrCache.lastUpdated = new Date().toISOString();
  return nrrCache;
}

// ---- Main ----
async function update() {
  console.log(`[${new Date().toISOString()}] Updating IPL data...\n`);

  // Load existing data
  let existingData = {};
  if (existsSync(DATA_PATH)) {
    existingData = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  }

  // Load NRR cache
  let nrrCache = {
    processedMatchIds: [],
    teamNrrData: {},
    nrr: {},
    lastUpdated: null,
  };
  if (existsSync(NRR_CACHE_PATH)) {
    nrrCache = JSON.parse(readFileSync(NRR_CACHE_PATH, 'utf-8'));
  } else {
    console.log('⚠️  No NRR cache found. Run `node scripts/bootstrap-nrr.js` first.\n');
  }

  try {
    // 1. Fetch standings
    const liveStandings = await fetchPointsTable();
    if (!liveStandings || liveStandings.length !== 10) {
      console.log(`⚠️  Expected 10 teams, got ${liveStandings?.length || 0}. Aborting.`);
      return;
    }

    // 2. Incrementally update NRR
    nrrCache = await updateNRR(nrrCache);

    // 3. Merge NRR into standings
    for (const team of liveStandings) {
      team.nrr = nrrCache.nrr[team.id] || 0;
    }

    // 4. Filter remaining matches
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const remainingMatches = (existingData.remainingMatches || []).filter(m => m.date >= today);

    // 5. Write updated data
    const newData = {
      lastUpdated: new Date().toISOString(),
      season: 'IPL 2026',
      teams: existingData.teams, // KEEP existing correct teams for now
      remainingMatches,
    };
    writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2));

    // 6. Save NRR cache
    // writeFileSync(NRR_CACHE_PATH, JSON.stringify(nrrCache, null, 2));

    console.log(`\n✅ Updated: remaining matches only. Teams data is locked manually due to CricAPI inaccuracies.`);
    console.log('NRR values:');
    for (const t of liveStandings) {
      console.log(`  ${t.shortName.padEnd(5)} ${t.nrr >= 0 ? '+' : ''}${t.nrr.toFixed(3)}`);
    }

  } catch (e) {
    console.error('❌ Update failed:', e.message);
  }
}

update();
