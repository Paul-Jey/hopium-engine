import './style.css';
import state, { subscribe, notify } from './state.js';
import { calculateStandings, getQualificationStatus, getStatusMessage, getSimulatedRecord } from './engine.js';
import { TEAM_COLORS, getTeamLogo } from './teams.js';
import { encodeToURL, decodeFromURL } from './url.js';

// ---- Boot ----
async function init() {
  // Load data
  const res = await fetch('/data/ipl2026.json');
  const data = await res.json();

  state.teams = data.teams;
  state.remainingMatches = data.remainingMatches;
  state.lastUpdated = data.lastUpdated;

  // Restore from URL if present
  const urlState = decodeFromURL();
  if (urlState.selectedTeam) state.selectedTeam = urlState.selectedTeam;
  if (Object.keys(urlState.simulatedResults).length > 0) {
    state.simulatedResults = urlState.simulatedResults;
  }

  // Initial calculation
  recalculate();

  // Render shell
  renderApp();

  // Set up one-time event delegation for match list
  setupMatchListDelegation();

  // Subscribe components
  subscribe(renderPointsTable);
  subscribe(renderMatchList);
  subscribe(renderStatusBanner);
  subscribe(renderShareBtn);
  subscribe(updateAccentColor);
  subscribe(updateHopiumButton);
  subscribe(syncURL);

  // Trigger first render
  notify();
}

function recalculate() {
  state.standings = calculateStandings(state.teams, state.remainingMatches, state.simulatedResults);
}

function syncURL() {
  encodeToURL(state.selectedTeam, state.simulatedResults);
}

function updateAccentColor() {
  if (state.selectedTeam && TEAM_COLORS[state.selectedTeam]) {
    const c = TEAM_COLORS[state.selectedTeam];
    document.documentElement.style.setProperty('--accent', c.primary);
    document.documentElement.style.setProperty('--accent-dim', hexToRGBA(c.primary, 0.12));
    document.documentElement.style.setProperty('--accent-glow', hexToRGBA(c.primary, 0.3));
  }
}

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Render Shell ----
function renderApp() {
  const app = document.getElementById('app');

  const updated = state.lastUpdated
    ? new Date(state.lastUpdated).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    : '';

  app.innerHTML = `
    <header class="header">
      <h1 class="header__title">HOPIUM ENGINE</h1>
      <p class="header__subtitle">easy calculator, no brain activity</p>
      ${updated ? `<p class="header__updated">IPL 2026 · Data as of ${updated}</p>` : ''}
    </header>

    <div class="team-picker" id="team-picker"></div>

    <div class="main-grid">
      <div>
        <h2 class="section-header">Points Table</h2>
        <div class="points-table-wrapper">
          <table class="points-table" id="points-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>P</th>
                <th>W</th>
                <th>L</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody id="points-table-body"></tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 class="section-header">Remaining Matches</h2>
        <div id="match-controls" class="match-list__controls"></div>
        <div class="progress-bar" id="progress-bar">
          <span id="progress-text">0/${state.remainingMatches.length} decided</span>
          <div class="progress-bar__track">
            <div class="progress-bar__fill" id="progress-fill" style="width: 0%"></div>
          </div>
        </div>
        <div class="match-list" id="match-list"></div>
      </div>
    </div>
  `;

  renderTeamPicker();
  renderMatchControls();
}

// ---- Team Picker ----
function renderTeamPicker() {
  const container = document.getElementById('team-picker');
  container.innerHTML = state.teams.map(team => {
    const isActive = state.selectedTeam === team.id;
    return `
      <button class="team-pill ${isActive ? 'team-pill--active' : ''}" 
              data-team="${team.id}" id="pick-${team.id}">
        <span class="team-pill__logo">${getTeamLogo(team.id, team.shortName, 28)}</span>
        <span class="team-pill__name">${team.shortName}</span>
      </button>
    `;
  }).join('');

  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.team-pill');
    if (!pill) return;
    const teamId = pill.dataset.team;
    state.selectedTeam = state.selectedTeam === teamId ? null : teamId;
    recalculate();

    // Update picker active states
    container.querySelectorAll('.team-pill').forEach(p => {
      p.classList.toggle('team-pill--active', p.dataset.team === state.selectedTeam);
    });

    notify();
  });
}

// ---- Match Controls ----
function renderMatchControls() {
  const container = document.getElementById('match-controls');
  container.innerHTML = `
    <button class="btn" id="btn-reset">Reset All</button>
    <button class="btn" id="btn-random">Randomize</button>
    <button class="btn btn--hopium" id="btn-hopium">🔥 Make My Team Win</button>
  `;

  document.getElementById('btn-reset').addEventListener('click', () => {
    state.simulatedResults = {};
    recalculate();
    notify();
  });

  document.getElementById('btn-random').addEventListener('click', () => {
    state.remainingMatches.forEach(match => {
      // No NR in randomize — just pick a winner
      state.simulatedResults[match.id] = Math.random() < 0.5 ? match.team1 : match.team2;
    });
    recalculate();
    notify();
  });

  document.getElementById('btn-hopium').addEventListener('click', () => {
    if (!state.selectedTeam) return;
    state.remainingMatches.forEach(match => {
      const involves = match.team1 === state.selectedTeam || match.team2 === state.selectedTeam;
      if (involves) {
        // Selected team always wins
        state.simulatedResults[match.id] = state.selectedTeam;
      } else {
        // Random winner for other matches
        state.simulatedResults[match.id] = Math.random() < 0.5 ? match.team1 : match.team2;
      }
    });
    recalculate();
    notify();
  });
}

// Update hopium button disabled state when team changes
function updateHopiumButton() {
  const btn = document.getElementById('btn-hopium');
  if (!btn) return;
  btn.disabled = !state.selectedTeam;
}

// ---- Points Table ----
function renderPointsTable() {
  const tbody = document.getElementById('points-table-body');
  if (!tbody) return;

  const oldPositions = {};
  tbody.querySelectorAll('tr').forEach(row => {
    const id = row.dataset.team;
    if (id) oldPositions[id] = row.getBoundingClientRect().top;
  });

  tbody.innerHTML = state.standings.map((team, i) => {
    const rank = i + 1;
    const record = getSimulatedRecord(team);
    const isSelected = team.id === state.selectedTeam;
    const isQualified = rank <= 4;
    const isEdge = rank === 5;

    let rowClass = '';
    if (isQualified) rowClass += ' points-table__row--qualified';
    if (isEdge) rowClass += ' points-table__row--edge';
    if (isSelected) rowClass += ' points-table__row--selected';

    const isQualLine = rank === 4;

    return `
      <tr class="${rowClass} ${isQualLine ? 'points-table__qual-line' : ''}" data-team="${team.id}">
        <td class="points-table__rank">${rank}</td>
        <td>
          <div class="points-table__team">
            ${getTeamLogo(team.id, team.shortName, 24)}
            <span class="points-table__team-name">${team.shortName}</span>
          </div>
        </td>
        <td>${record.played}</td>
        <td>${record.won}</td>
        <td>${record.lost}</td>
        <td class="points-table__pts">${team.simPoints}</td>
      </tr>
    `;
  }).join('');

  // Animate row reordering
  tbody.querySelectorAll('tr').forEach(row => {
    const id = row.dataset.team;
    if (id && oldPositions[id] !== undefined) {
      const newTop = row.getBoundingClientRect().top;
      const delta = oldPositions[id] - newTop;
      if (Math.abs(delta) > 1) {
        row.style.transform = `translateY(${delta}px)`;
        row.style.transition = 'none';
        requestAnimationFrame(() => {
          row.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
          row.style.transform = 'translateY(0)';
        });
      }
    }
  });
}

// ---- Match List ----
function renderMatchList() {
  const container = document.getElementById('match-list');
  if (!container) return;

  // Sort: matches involving selected team first
  const sorted = [...state.remainingMatches].sort((a, b) => {
    const aRelevant = state.selectedTeam && (a.team1 === state.selectedTeam || a.team2 === state.selectedTeam);
    const bRelevant = state.selectedTeam && (b.team1 === state.selectedTeam || b.team2 === state.selectedTeam);
    if (aRelevant && !bRelevant) return -1;
    if (!aRelevant && bRelevant) return 1;
    return new Date(a.date) - new Date(b.date);
  });

  const teamMap = {};
  state.teams.forEach(t => { teamMap[t.id] = t; });

  container.innerHTML = sorted.map(match => {
    const t1 = teamMap[match.team1];
    const t2 = teamMap[match.team2];
    if (!t1 || !t2) return '';

    const result = state.simulatedResults[match.id];
    const isRelevant = state.selectedTeam && (match.team1 === state.selectedTeam || match.team2 === state.selectedTeam);

    const isNR = result === 'nr';
    const t1Class = result === match.team1 ? 'match-card__team--winner' : (result && !isNR) ? 'match-card__team--loser' : isNR ? 'match-card__team--loser' : '';
    const t2Class = result === match.team2 ? 'match-card__team--winner' : (result && !isNR) ? 'match-card__team--loser' : isNR ? 'match-card__team--loser' : '';
    const nrActive = isNR ? 'match-card__nr-btn--active' : '';

    const dateStr = new Date(match.date + 'T00:00:00').toLocaleDateString('en-IN', {
      month: 'short', day: 'numeric'
    });

    return `
      <div class="match-card ${isRelevant ? 'match-card--relevant' : ''}" data-match="${match.id}">
        <div class="match-card__meta">
          <span>${dateStr}</span>
          <span>${match.venue}</span>
        </div>
        <div class="match-card__teams">
          <div class="match-card__team ${t1Class}" data-pick="${match.team1}" data-match-id="${match.id}">
            ${getTeamLogo(match.team1, t1.shortName, 32)}
            <span class="match-card__team-name">${t1.shortName}</span>
          </div>
          <div class="match-card__vs">
            <div>vs</div>
            <button class="match-card__nr-btn ${nrActive}" data-nr="${match.id}">NR</button>
          </div>
          <div class="match-card__team ${t2Class}" data-pick="${match.team2}" data-match-id="${match.id}">
            <span class="match-card__team-name">${t2.shortName}</span>
            ${getTeamLogo(match.team2, t2.shortName, 32)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Update progress
  updateProgress();
}

function setupMatchListDelegation() {
  const container = document.getElementById('match-list');
  if (!container) return;
  container.addEventListener('click', handleMatchClick);
}

function handleMatchClick(e) {
  // Team pick
  const teamEl = e.target.closest('[data-pick]');
  if (teamEl) {
    const matchId = teamEl.dataset.matchId;
    const teamId = teamEl.dataset.pick;
    // Toggle: if already selected this team, deselect
    if (state.simulatedResults[matchId] === teamId) {
      delete state.simulatedResults[matchId];
    } else {
      state.simulatedResults[matchId] = teamId;
    }
    recalculate();
    notify();
    return;
  }

  // NR button
  const nrBtn = e.target.closest('[data-nr]');
  if (nrBtn) {
    const matchId = nrBtn.dataset.nr;
    if (state.simulatedResults[matchId] === 'nr') {
      delete state.simulatedResults[matchId];
    } else {
      state.simulatedResults[matchId] = 'nr';
    }
    recalculate();
    notify();
    return;
  }
}

function updateProgress() {
  const total = state.remainingMatches.length;
  const decided = Object.keys(state.simulatedResults).length;
  const pct = total > 0 ? (decided / total * 100) : 0;

  const text = document.getElementById('progress-text');
  const fill = document.getElementById('progress-fill');
  if (text) text.textContent = `${decided}/${total} decided`;
  if (fill) fill.style.width = `${pct}%`;
}

// ---- Status Banner ----
function renderStatusBanner() {
  const banner = document.getElementById('status-banner');
  if (!banner) return;

  if (!state.selectedTeam) {
    banner.classList.remove('status-banner--visible');
    return;
  }

  const status = getQualificationStatus(state.selectedTeam, state.standings);
  const message = getStatusMessage(state.selectedTeam, state.standings);

  banner.className = 'status-banner status-banner--visible';

  let icon = '';
  if (status === 'QUALIFIED') {
    banner.classList.add('status-banner--qualified');
    icon = '✅';
  } else if (status === 'ON_THE_EDGE') {
    banner.classList.add('status-banner--edge');
    icon = '⚠️';
  } else {
    banner.classList.add('status-banner--eliminated');
    icon = '❌';
  }

  banner.innerHTML = `<span class="status-banner__icon">${icon}</span> ${message}`;
}

// ---- Share Button ----
function renderShareBtn() {
  const btn = document.getElementById('share-btn');
  if (!btn) return;

  const hasSelections = Object.keys(state.simulatedResults).length > 0 || state.selectedTeam;
  btn.classList.toggle('share-btn--visible', !!hasSelections);
}

// Share button click handler
document.getElementById('share-btn')?.addEventListener('click', async () => {
  const textEl = document.getElementById('share-text');
  try {
    await navigator.clipboard.writeText(window.location.href);
    textEl.textContent = 'Copied!';
    textEl.classList.add('share-btn__copied');
    setTimeout(() => {
      textEl.textContent = 'Share';
      textEl.classList.remove('share-btn__copied');
    }, 2000);
  } catch {
    // Fallback
    const input = document.createElement('input');
    input.value = window.location.href;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    textEl.textContent = 'Copied!';
    setTimeout(() => { textEl.textContent = 'Share'; }, 2000);
  }
});

// ---- Go ----
init().catch(err => {
  console.error('Failed to initialize:', err);
  document.getElementById('app').innerHTML = `
    <div class="empty-state">
      <div class="empty-state__icon">⚠️</div>
      <p class="empty-state__text">Failed to load data. Please try refreshing.</p>
    </div>
  `;
});
