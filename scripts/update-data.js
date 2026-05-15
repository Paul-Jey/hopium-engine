/**
 * IPL 2026 Data Updater
 * 
 * Fetches current IPL standings from CricAPI.
 * Run with: node scripts/update-data.js
 * 
 * Scheduled via GitHub Actions at 12:00 AM IST (18:30 UTC) daily.
 * Uses 1 API call per run to conserve the 100/day limit.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'public', 'data', 'ipl2026.json');

const API_KEY = 'ccb921ce-bd11-4749-aeb5-c1690182b6b3';
const SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'; // Indian Premier League 2026

// ---- Team ID mapping ----
// Maps API shortnames/teamnames to our internal IDs.
// This is the ONLY place team identity is resolved — no fuzzy matching.
const SHORTNAME_TO_ID = {
  'CSK':  'csk',
  'DC':   'dc',
  'GT':   'gt',
  'KKR':  'kkr',
  'LSG':  'lsg',
  'MI':   'mi',
  'PBKS': 'pbks',
  'RR':   'rr',
  'RCBW': 'rcb',   // CricAPI uses RCBW for Royal Challengers Bengaluru
  'RCB':  'rcb',
  'SRH':  'srh',
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

// ---- Fetch & Parse ----
async function fetchPointsTable() {
  try {
    console.log('Fetching standings from CricAPI...');
    const res = await fetch(`https://api.cricapi.com/v1/series_points?id=${SERIES_ID}&apikey=${API_KEY}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (json.status !== 'success') {
      throw new Error(`CricAPI error: ${json.reason || 'Unknown'}`);
    }

    console.log(`API hit count: ${json.info?.hitsToday || '?'}/${json.info?.hitsLimit || '?'} today`);
    return parseCricApiStandings(json.data);

  } catch (e) {
    console.error('Error fetching data from CricAPI:', e.message);
    return null;
  }
}

function parseCricApiStandings(dataList) {
  const seen = new Set(); // Guard against duplicates

  return dataList.map(ts => {
    // Resolve team ID using the explicit shortname map
    const teamId = SHORTNAME_TO_ID[ts.shortname] || null;
    
    if (!teamId) {
      console.warn(`Unknown team shortname: "${ts.shortname}" (${ts.teamname}) — skipping`);
      return null;
    }

    // Skip if we've already seen this team (prevents duplicates)
    if (seen.has(teamId)) {
      console.warn(`Duplicate team entry for ${teamId} — skipping`);
      return null;
    }
    seen.add(teamId);

    const played = parseInt(ts.matches || 0);
    const won = parseInt(ts.wins || 0);
    const lost = parseInt(ts.loss || 0);
    const nr = parseInt(ts.nr || 0);
    const ties = parseInt(ts.ties || 0);
    const points = (won * 2) + nr + ties;

    return {
      id: teamId,
      name: TEAMS_META[teamId]?.name || ts.teamname,
      shortName: TEAMS_META[teamId]?.shortName || ts.shortname,
      played,
      won,
      lost,
      noResult: nr + ties,
      points,
    };
  }).filter(Boolean); // Remove nulls
}

// ---- Main ----
async function update() {
  console.log(`[${new Date().toISOString()}] Updating IPL data...`);

  // Load existing data to preserve remaining matches
  let existingData = {};
  if (existsSync(DATA_PATH)) {
    existingData = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  }

  const liveStandings = await fetchPointsTable();

  if (!liveStandings || liveStandings.length !== 10) {
    console.log(`⚠️  Expected 10 teams, got ${liveStandings?.length || 0}. Keeping existing data.`);
    return;
  }

  // Filter out completed matches by date (IST timezone)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const remainingMatches = (existingData.remainingMatches || []).filter(m => m.date >= today);

  const newData = {
    lastUpdated: new Date().toISOString(),
    season: 'IPL 2026',
    teams: liveStandings,
    remainingMatches,
  };

  writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2));
  console.log(`✅ Updated: ${liveStandings.length} teams, ${remainingMatches.length} remaining matches.`);
}

update();
