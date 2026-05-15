/**
 * One-time NRR Bootstrap Script
 * 
 * Fetches ALL completed match scores from CricAPI and calculates NRR for every team.
 * Stores the raw cumulative data in a cache file so daily updates only need
 * to fetch new matches (1-2 per day = 1-2 API hits).
 * 
 * Run once: node scripts/bootstrap-nrr.js
 * Uses ~60 API hits (one per match + series_info)
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NRR_CACHE_PATH = join(__dirname, '..', 'public', 'data', 'nrr-cache.json');

const API_KEY = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f';

const SHORTNAME_TO_ID = {
  'CSK': 'csk', 'DC': 'dc', 'GT': 'gt', 'KKR': 'kkr', 'LSG': 'lsg',
  'MI': 'mi', 'PBKS': 'pbks', 'RR': 'rr', 'RCBW': 'rcb', 'RCB': 'rcb', 'SRH': 'srh',
};

function resolveTeamId(teamName, teamInfoList) {
  // Try to match using teamInfo shortnames first (most reliable)
  if (teamInfoList) {
    for (const info of teamInfoList) {
      if (info.name === teamName && SHORTNAME_TO_ID[info.shortname]) {
        return SHORTNAME_TO_ID[info.shortname];
      }
    }
  }
  // Fallback: fuzzy match on known names
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

async function bootstrap() {
  console.log('🏏 NRR Bootstrap — fetching all match scores...\n');

  // 1. Get all match IDs
  const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?id=${SERIES_ID}&apikey=${API_KEY}`);
  const seriesJson = await seriesRes.json();
  
  if (seriesJson.status !== 'success') {
    console.error('Failed to fetch series info');
    return;
  }

  const endedMatches = seriesJson.data.matchList.filter(m => m.matchEnded === true);
  console.log(`Found ${endedMatches.length} completed matches. Fetching scores...\n`);

  // 2. Initialize NRR accumulator for each team
  const nrrData = {};
  for (const id of Object.values(SHORTNAME_TO_ID)) {
    if (!nrrData[id]) {
      nrrData[id] = {
        runsScored: 0,
        oversFaced: 0,
        runsConceded: 0,
        oversBowled: 0,
        matchesProcessed: 0,
      };
    }
  }

  // 3. Fetch each match and accumulate run/over data
  let processed = 0;
  const processedMatchIds = [];

  for (const match of endedMatches) {
    processed++;
    process.stdout.write(`  [${processed}/${endedMatches.length}] ${match.name.substring(0, 60)}...`);

    try {
      // Rate-limit: wait 200ms between requests
      await sleep(200);

      const matchRes = await fetch(`https://api.cricapi.com/v1/match_info?id=${match.id}&apikey=${API_KEY}`);
      const matchJson = await matchRes.json();

      if (matchJson.status !== 'success' || !matchJson.data?.score?.length) {
        console.log(' ⚠️ no score data');
        continue;
      }

      const data = matchJson.data;
      const scores = data.score;
      const teamInfo = data.teamInfo || [];

      // Identify which team batted which innings
      // Format: "Chennai Super Kings Inning 1"
      if (scores.length < 2) {
        console.log(' ⚠️ incomplete innings');
        continue;
      }

      // Extract team names from inning labels
      const inning1Team = scores[0].inning.replace(/\s+Inning\s+\d+$/i, '').trim();
      const inning2Team = scores[1].inning.replace(/\s+Inning\s+\d+$/i, '').trim();

      const team1Id = resolveTeamId(inning1Team, teamInfo);
      const team2Id = resolveTeamId(inning2Team, teamInfo);

      if (!team1Id || !team2Id) {
        console.log(` ⚠️ unknown team: ${inning1Team} or ${inning2Team}`);
        continue;
      }

      // Parse overs properly (e.g. 19.4 -> 19 + 4/6)
      function parseOvers(o, w) {
        if (w === 10) return 20; // If all out, deemed to have faced full quota (assuming 20)
        const parts = o.toString().split('.');
        const overs = parseInt(parts[0]);
        const balls = parseInt(parts[1] || '0');
        return overs + (balls / 6);
      }

      const o1 = parseOvers(scores[0].o, scores[0].w);
      const o2 = parseOvers(scores[1].o, scores[1].w);

      nrrData[team1Id].runsScored += scores[0].r;
      nrrData[team1Id].oversFaced += o1;
      nrrData[team1Id].runsConceded += scores[1].r;
      nrrData[team1Id].oversBowled += o2;
      nrrData[team1Id].matchesProcessed++;

      nrrData[team2Id].runsScored += scores[1].r;
      nrrData[team2Id].oversFaced += o2;
      nrrData[team2Id].runsConceded += scores[0].r;
      nrrData[team2Id].oversBowled += o1;
      nrrData[team2Id].matchesProcessed++;

      processedMatchIds.push(match.id);
      console.log(' ✅');

    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
  }

  // 4. Calculate NRR for each team
  console.log('\n--- NRR Results ---\n');
  
  const nrrResults = {};
  for (const [id, d] of Object.entries(nrrData)) {
    if (d.oversFaced === 0 || d.oversBowled === 0) {
      nrrResults[id] = 0;
      continue;
    }
    const runRate = d.runsScored / d.oversFaced;
    const concededRate = d.runsConceded / d.oversBowled;
    nrrResults[id] = +(runRate - concededRate).toFixed(3);
    console.log(`  ${id.toUpperCase().padEnd(5)} NRR: ${nrrResults[id] >= 0 ? '+' : ''}${nrrResults[id].toFixed(3)}  (${d.matchesProcessed} matches)`);
  }

  // 5. Save cache
  const cache = {
    lastBootstrap: new Date().toISOString(),
    processedMatchIds,
    teamNrrData: nrrData,
    nrr: nrrResults,
  };

  writeFileSync(NRR_CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`\n✅ NRR cache saved to ${NRR_CACHE_PATH}`);
  console.log(`   Processed ${processedMatchIds.length} matches.`);
  
  const finalRes = await fetch(`https://api.cricapi.com/v1/series_points?id=${SERIES_ID}&apikey=${API_KEY}`);
  const finalJson = await finalRes.json();
  console.log(`   API hits used today: ${finalJson.info?.hitsToday || '?'}/100`);
}

bootstrap().catch(console.error);
