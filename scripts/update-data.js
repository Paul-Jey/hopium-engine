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

async function fetchPointsTable() {
  const apiKey = '3edd77d2-fc1e-435a-b2fc-ea6ebf966d85';
  const apiHost = 'cricket-highlights-api.p.rapidapi.com';
  const headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': apiHost
  };

  try {
    // 1. Get League ID for Indian Premier League
    console.log('Fetching League ID for Indian Premier League...');
    const leagueRes = await fetch(`https://${apiHost}/leagues?name=Indian%20Premier%20League`, { headers });
    if (!leagueRes.ok) throw new Error(`Failed to fetch leagues: ${leagueRes.status}`);
    
    const leagueData = await leagueRes.json();
    const iplLeague = leagueData.data.find(l => l.name === 'Indian Premier League' || l.name.includes('Indian Premier'));
    
    if (!iplLeague) {
      console.error('Could not find Indian Premier League in API response.');
      return null;
    }
    
    const leagueId = iplLeague.id;
    console.log(`Found IPL League ID: ${leagueId}`);

    // 2. Get Standings
    console.log('Fetching Standings...');
    const standingsRes = await fetch(`https://${apiHost}/standings?leagueId=${leagueId}&season=2026`, { headers });
    if (!standingsRes.ok) throw new Error(`Failed to fetch standings: ${standingsRes.status}`);
    
    const standingsData = await standingsRes.json();
    return parseHighlightyStandings(standingsData);

  } catch (e) {
    console.error('Error fetching data from Highlighty API:', e);
    return null;
  }
}

function parseHighlightyStandings(data) {
  try {
    // The API might return an array of groups, usually IPL is in a single group
    // Adjust based on the actual API structure, assuming it returns data inside a 'data' array
    // Example: {"data": [ { "team": { "name": "...", ... }, "points": 14, "played": 11, ... } ]}
    
    const standingsList = Array.isArray(data.data) ? data.data : data;
    
    return standingsList.map(ts => {
      // Highlighty team object might be inside a 'team' property
      const teamName = ts.team?.name || ts.name || '';
      const teamId = findTeamId(teamName);
      
      return {
        id: teamId,
        name: TEAMS_META[teamId]?.name || teamName,
        shortName: TEAMS_META[teamId]?.shortName || ts.team?.abbreviation || ts.abbreviation || '',
        played: parseInt(ts.matchesPlayed || ts.played || 0),
        won: parseInt(ts.matchesWon || ts.won || 0),
        lost: parseInt(ts.matchesLost || ts.lost || 0),
        noResult: parseInt(ts.noResult || ts.nr || ts.draws || 0),
        points: parseInt(ts.points || 0),
        nrr: parseFloat(ts.netRunRate || ts.nrr || 0),
      };
    }).filter(t => t.id); // Filter out unmapped teams
  } catch (e) {
    console.error('Failed to parse Highlighty data:', e);
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

  // Try to fetch live data
  const liveStandings = await fetchPointsTable();

  if (liveStandings && liveStandings.length === 10) {
    // Load existing data to preserve remaining matches
    let existingData = {};
    if (existsSync(DATA_PATH)) {
      existingData = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
    }

    // Filter out completed matches (where the date has passed)
    const today = new Date().toISOString().split('T')[0];
    const remainingMatches = (existingData.remainingMatches || []).filter(
      m => m.date >= today
    );

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
