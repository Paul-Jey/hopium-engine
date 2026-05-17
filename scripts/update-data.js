/**
 * IPL 2026 Incremental Data Updater
 * 
 * Anchored to the May 17 standings baseline. Daily updates are processed by checking
 * for new completed matches in CricAPI, parsing results/scores, and incrementally
 * updating the team records and NRR cache.
 * 
 * Scheduled daily via GitHub Actions.
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

// Parse winner from match status string
function parseMatchWinner(statusStr, team1Id, team2Id, teamInfo) {
  const status = statusStr.toLowerCase();

  // Handle no result / abandoned matches
  if (status.includes('abandoned') || status.includes('no result') || status.includes('washed out') || status.includes('tied')) {
    return 'nr';
  }

  // Resolve winner name using team names
  for (const info of teamInfo) {
    const resolvedId = SHORTNAME_TO_ID[info.shortname] || resolveTeamId(info.name);
    if (resolvedId && status.includes(info.name.toLowerCase())) {
      return resolvedId;
    }
  }

  // Fallback direct name match check
  if (status.includes('chennai') || status.includes('super kings')) return 'csk';
  if (status.includes('delhi') || status.includes('capitals')) return 'dc';
  if (status.includes('gujarat') || status.includes('titans')) return 'gt';
  if (status.includes('kolkata') || status.includes('knight riders')) return 'kkr';
  if (status.includes('lucknow') || status.includes('super giants')) return 'lsg';
  if (status.includes('mumbai') || status.includes('indians')) return 'mi';
  if (status.includes('punjab') || status.includes('kings')) return 'pbks';
  if (status.includes('rajasthan') || status.includes('royals')) return 'rr';
  if (status.includes('bengaluru') || status.includes('royal challengers')) return 'rcb';
  if (status.includes('sunrisers') || status.includes('hyderabad')) return 'srh';

  return 'nr'; // default fallback
}

// Parse overs properly (e.g. 19.4 -> 19 + 4/6)
function parseOvers(o, w) {
  if (w === 10) return 20; // If all out, deemed to have faced full quota of 20 overs
  const parts = o.toString().split('.');
  const overs = parseInt(parts[0]);
  const balls = parseInt(parts[1] || '0');
  return overs + (balls / 6);
}

// ---- Main ----
async function update() {
  console.log(`[${new Date().toISOString()}] Updating IPL data incrementally...\n`);

  if (!existsSync(DATA_PATH) || !existsSync(NRR_CACHE_PATH)) {
    console.error('❌ Data files missing. Run initialize-cache.js first.');
    return;
  }

  const iplData = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const nrrCache = JSON.parse(readFileSync(NRR_CACHE_PATH, 'utf-8'));

  try {
    // 1. Fetch series info to find ended matches
    console.log('Fetching series info from CricAPI...');
    const seriesRes = await fetch(`https://api.cricapi.com/v1/series_info?id=${SERIES_ID}&apikey=${API_KEY}`);
    const seriesJson = await seriesRes.json();
    if (seriesJson.status !== 'success') {
      throw new Error(`Failed to fetch series info: ${seriesJson.reason || 'Unknown reason'}`);
    }

    const allEnded = seriesJson.data.matchList.filter(m => m.matchEnded === true);
    const alreadyProcessed = new Set(nrrCache.processedMatchIds || []);
    const newMatches = allEnded.filter(m => !alreadyProcessed.has(m.id));

    if (newMatches.length === 0) {
      console.log('✅ No new matches to process. Standing and NRR are perfectly up to date.');
      return;
    }

    console.log(`Found ${newMatches.length} new completed match(es) to process.`);

    for (const match of newMatches) {
      console.log(`Processing: ${match.name}...`);
      await sleep(200);

      const matchRes = await fetch(`https://api.cricapi.com/v1/match_info?id=${match.id}&apikey=${API_KEY}`);
      const matchJson = await matchRes.json();

      if (matchJson.status !== 'success' || !matchJson.data?.score?.length) {
        console.log(`  ⚠️ Scorecard not ready or unavailable for match ${match.id} - skipping`);
        continue;
      }

      const scores = matchJson.data.score;
      const teamInfo = matchJson.data.teamInfo || [];

      // Determine teams
      const inning1Team = scores[0].inning.replace(/\s+Inning\s+\d+$/i, '').trim();
      const inning2Team = scores[1] ? scores[1].inning.replace(/\s+Inning\s+\d+$/i, '').trim() : '';
      
      const team1Id = resolveTeamId(inning1Team, teamInfo);
      const team2Id = inning2Team ? resolveTeamId(inning2Team, teamInfo) : null;

      if (!team1Id || (inning2Team && !team2Id)) {
        console.log(`  ⚠️ Could not resolve team IDs for: ${inning1Team} or ${inning2Team}`);
        nrrCache.processedMatchIds.push(match.id);
        continue;
      }

      // 1. Update Wins/Losses/Points
      const winnerId = parseMatchWinner(matchJson.data.status, team1Id, team2Id, teamInfo);
      console.log(`  Winner parsed: ${winnerId}`);

      const team1 = iplData.teams.find(t => t.id === team1Id);
      const team2 = team2Id ? iplData.teams.find(t => t.id === team2Id) : null;

      if (winnerId === 'nr') {
        // No result
        if (team1) {
          team1.played += 1;
          team1.noResult += 1;
          team1.points += 1;
        }
        if (team2) {
          team2.played += 1;
          team2.noResult += 1;
          team2.points += 1;
        }
      } else {
        const loserId = (winnerId === team1Id) ? team2Id : team1Id;
        const winner = iplData.teams.find(t => t.id === winnerId);
        const loser = loserId ? iplData.teams.find(t => t.id === loserId) : null;

        if (winner) {
          winner.played += 1;
          winner.won += 1;
          winner.points += 2;
        }
        if (loser) {
          loser.played += 1;
          loser.lost += 1;
        }
      }

      // 2. Update NRR Cache
      if (scores.length >= 2 && team2Id) {
        const o1 = parseOvers(scores[0].o, scores[0].w);
        const o2 = parseOvers(scores[1].o, scores[1].w);

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
      }

      nrrCache.processedMatchIds.push(match.id);
      console.log(`  ✅ Successfully updated standings and NRR cache for match.`);
    }

    // 3. Recalculate NRR and update teams in iplData
    for (const team of iplData.teams) {
      const d = nrrCache.teamNrrData[team.id];
      if (d && d.oversFaced > 0 && d.oversBowled > 0) {
        const calculatedNrr = +((d.runsScored / d.oversFaced) - (d.runsConceded / d.oversBowled)).toFixed(3);
        team.nrr = calculatedNrr;
        nrrCache.nrr[team.id] = calculatedNrr;
      }
    }

    // 4. Sort teams in points table (points desc, NRR desc)
    iplData.teams.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.nrr - a.nrr;
    });

    // 5. Filter played matches out of remainingMatches
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    iplData.remainingMatches = iplData.remainingMatches.filter(m => m.date >= today);

    iplData.lastUpdated = new Date().toISOString();
    nrrCache.lastUpdated = new Date().toISOString();

    // 6. Save files
    writeFileSync(DATA_PATH, JSON.stringify(iplData, null, 2));
    writeFileSync(NRR_CACHE_PATH, JSON.stringify(nrrCache, null, 2));

    console.log(`\n🎉 Success! Standings updated:`);
    for (const t of iplData.teams) {
      console.log(`  ${t.shortName.padEnd(5)} P:${t.played} W:${t.won} L:${t.lost} Pts:${t.points} NRR:${t.nrr >= 0 ? '+' : ''}${t.nrr.toFixed(3)}`);
    }

  } catch (e) {
    console.error('❌ Update failed:', e.message);
  }
}

update();
