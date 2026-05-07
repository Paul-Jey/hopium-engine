// Dead-simple reactive state. No library.
const state = {
  teams: [],
  remainingMatches: [],
  selectedTeam: null,       // team ID string
  simulatedResults: {},     // { matchId: 'team1id' | 'team2id' | 'nr' }
  standings: [],            // computed on every change
  lastUpdated: null,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
}

export function notify() {
  listeners.forEach(fn => fn(state));
}

export default state;
