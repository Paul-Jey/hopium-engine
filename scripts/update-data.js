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
  // Scrape from a public, CORS-friendly source
  // Using the ESPN Cricinfo API endpoint pattern
  try {
    // Try ESPNCricinfo series standings endpoint
    const url = 'https://hs-consumer-api.espncricinfo.com/v1/pages/series/standings?lang=en&seriesId=1497672';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (res.ok) {
      const data = await res.json();
      return parseESPNStandings(data);
    }
  } catch (e) {
    console.log('ESPN API failed, trying Cricbuzz...');
  }

  // Fallback: try alternate approach
  try {
    const url = 'https://www.cricbuzz.com/api/html/cricket-scorecard-commentary/series/9237/points-table';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });

    if (res.ok) {
      const text = await res.text();
      return parseCricbuzzStandings(text);
    }
  } catch (e) {
    console.log('Cricbuzz also failed.');
  }

  return null;
}

function parseESPNStandings(data) {
  // ESPN Cricinfo API response parser
  try {
    const standings = data?.content?.standings?.groups?.[0]?.teamStats || [];
    return standings.map(ts => {
      const teamName = ts.teamInfo?.name || '';
      const teamId = findTeamId(teamName);
      return {
        id: teamId,
        name: TEAMS_META[teamId]?.name || teamName,
        shortName: TEAMS_META[teamId]?.shortName || ts.teamInfo?.abbreviation || '',
        played: ts.matchesPlayed || 0,
        won: ts.matchesWon || 0,
        lost: ts.matchesLost || 0,
        noResult: ts.noResult || 0,
        points: ts.points || 0,
        nrr: parseFloat(ts.nrr) || 0,
      };
    }).filter(t => t.id);
  } catch (e) {
    console.error('Failed to parse ESPN data:', e);
    return null;
  }
}

function parseCricbuzzStandings(html) {
  // Basic HTML parser for Cricbuzz points table
  // This is fragile — only used as fallback
  console.log('Cricbuzz HTML parsing not fully implemented. Using cached data.');
  return null;
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
