/**
 * URL state encoding/decoding for shareable scenarios.
 */

let debounceTimer = null;

export function encodeToURL(selectedTeam, simulatedResults) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const params = new URLSearchParams();
    if (selectedTeam) params.set('team', selectedTeam);
    for (const [matchId, winner] of Object.entries(simulatedResults)) {
      params.set(matchId, winner);
    }
    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }, 300);
}

export function decodeFromURL() {
  const params = new URLSearchParams(window.location.search);
  const selectedTeam = params.get('team') || null;
  const simulatedResults = {};

  for (const [key, value] of params.entries()) {
    if (key !== 'team' && key.startsWith('m')) {
      simulatedResults[key] = value;
    }
  }

  return { selectedTeam, simulatedResults };
}
