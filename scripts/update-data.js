/**
 * IPL 2026 Data Updater
 * 
 * Scrapes current IPL standings and remaining fixtures.
 * Run with: node scripts/update-data.js
 * 
 * For automated daily updates, set up a cron job or Windows Task Scheduler:
 *   - Windows: schtasks /create /tn "IPL Data Update" /tr "node C:\path\to\scripts\update-data.js" /sc daily /st 06:30
 *   - Linux/Mac: 0 1 * * * cd /path/to/project && node scripts/update-data.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'public', 'data', 'ipl2026.json');

// Team metadata (never changes)
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

async function fetchPointsTable(existingData) {
  const apiKey = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
  const seriesId = '87c62aac-bc3c-4738-ab93-19da0690488f'; // Indian Premier League 2026

  try {
    console.log('Fetching Standings from CricAPI...');
    const standingsRes = await fetch(`https://api.cricapi.com/v1/series_points?id=${seriesId}&apikey=${apiKey}`);
    if (!standingsRes.ok) throw new Error(`Failed to fetch standings: ${standingsRes.status}`);
    
    const standingsData = await standingsRes.json();
    
    if (standingsData.status !== 'success') {
      throw new Error(`CricAPI returned failure: ${standingsData.reason || 'Unknown error'}`);
    }

    return parseCricApiStandings(standingsData.data, existingData);

  } catch (e) {
    console.error('Error fetching data from CricAPI:', e);
    return null;
  }
}

function parseCricApiStandings(dataList, existingData) {
  try {
    return dataList.map(ts => {
      const teamName = ts.teamname || '';
      let teamId = findTeamId(teamName);
      
      // Fallback: the API might use 'RCBW' for RCB, so handle that edge case
      if (ts.shortname === 'RCBW' || teamName.includes('Bengaluru')) teamId = 'rcb';
      
      // Extract the existing NRR since CricAPI doesn't provide it
      const existingTeamInfo = existingData.teams ? existingData.teams.find(t => t.id === teamId) : {};
      const nrr = existingTeamInfo ? (existingTeamInfo.nrr || 0) : 0;
      
      const played = parseInt(ts.matches || 0);
      const won = parseInt(ts.wins || 0);
      const lost = parseInt(ts.loss || 0);
      const nr = parseInt(ts.nr || 0);
      const ties = parseInt(ts.ties || 0);
      
      // Calculate points manually (2 per win, 1 per tie/nr)
      const points = (won * 2) + (ties * 1) + (nr * 1);
      
      return {
        id: teamId,
        name: TEAMS_META[teamId]?.name || teamName,
        shortName: TEAMS_META[teamId]?.shortName || ts.shortname || '',
        played: played,
        won: won,
        lost: lost,
        noResult: nr + ties, // Combine ties and NR for simplicity
        points: points,
        nrr: nrr,
      };
    }).filter(t => t.id); // Filter out unmapped teams
  } catch (e) {
    console.error('Failed to parse CricAPI data:', e);
    return null;
  }
}

function findTeamId(name) {
  const lower = name.toLowerCase();
  for (const [id, meta] of Object.entries(TEAMS_META)) {
    if (lower.includes(meta.name.toLowerCase().split(' ')[0])) return id;
    if (lower.includes(meta.shortName.toLowerCase())) return id;
  }
  return '';
}

async function update() {
  console.log(`[${new Date().toISOString()}] Updating IPL data...`);

  // Load existing data first so we can preserve NRR
  let existingData = {};
  if (existsSync(DATA_PATH)) {
    existingData = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  }

  // Try to fetch live data
  const liveStandings = await fetchPointsTable(existingData);

  if (liveStandings && liveStandings.length === 10) {
    // Also fetch match list to see which matches ended
    let endedMatchIds = [];
    try {
      const apiKey = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
      const seriesId = '87c62aac-bc3c-4738-ab93-19da0690488f';
      const infoRes = await fetch(`https://api.cricapi.com/v1/series_info?id=${seriesId}&apikey=${apiKey}`);
      if (infoRes.ok) {
        const infoData = await infoRes.json();
        if (infoData && infoData.data && infoData.data.matchList) {
          endedMatchIds = infoData.data.matchList
            .filter(m => m.matchEnded === true)
            .map(m => m.id);
        }
      }
    } catch (e) {
      console.error('Failed to fetch match list for fixture filtering:', e);
    }

    // Filter out matches that have ended or where the date has passed
    // We use Asia/Kolkata timezone because the tournament and the cron job follow IST
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const remainingMatches = (existingData.remainingMatches || []).filter(m => {
      // If we have the match ID, check if it's in the ended list
      const hasEnded = endedMatchIds.includes(m.id);
      return !hasEnded && m.date >= today;
    });

    const newData = {
      lastUpdated: new Date().toISOString(),
      season: 'IPL 2026',
      teams: liveStandings,
      remainingMatches: remainingMatches,
    };

    writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2));
    console.log(`✅ Data updated successfully. ${liveStandings.length} teams, ${remainingMatches.length} remaining matches.`);
  } else {
    console.log('⚠️  Could not fetch live data. Keeping existing data file unchanged.');
    console.log('   To update manually, edit public/data/ipl2026.json directly.');
  }
}

update();
