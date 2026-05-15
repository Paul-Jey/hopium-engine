/**
 * Pure calculation engine. No side effects.
 */

export function calculateStandings(teams, remainingMatches, simulatedResults) {
  // Deep clone base team stats
  const standings = teams.map(t => ({
    ...t,
    simWon: 0,
    simLost: 0,
    simNR: 0,
    simPoints: t.points,
  }));

  const teamMap = {};
  standings.forEach(t => { teamMap[t.id] = t; });

  for (const match of remainingMatches) {
    const result = simulatedResults[match.id];
    if (!result) continue;

    const t1 = teamMap[match.team1];
    const t2 = teamMap[match.team2];
    if (!t1 || !t2) continue;

    if (result === match.team1) {
      t1.simWon++;
      t1.simPoints += 2;
      t2.simLost++;
    } else if (result === match.team2) {
      t2.simWon++;
      t2.simPoints += 2;
      t1.simLost++;
    } else if (result === 'nr') {
      t1.simNR++;
      t1.simPoints += 1;
      t2.simNR++;
      t2.simPoints += 1;
    }
  }

  // Sort: points desc, then NRR desc
  standings.sort((a, b) => {
    if (b.simPoints !== a.simPoints) return b.simPoints - a.simPoints;
    return (b.nrr || 0) - (a.nrr || 0);
  });

  return standings;
}

export function getQualificationStatus(teamId, standings) {
  const idx = standings.findIndex(t => t.id === teamId);
  if (idx < 0) return 'UNKNOWN';
  if (idx < 4) return 'QUALIFIED';
  
  // Rank 5 is only "On the Edge" if they have the same points as Rank 4
  if (idx === 4) {
    const team4 = standings[3];
    const team5 = standings[4];
    if (team4 && team5 && team4.simPoints === team5.simPoints) {
      return 'ON_THE_EDGE';
    }
  }
  
  return 'ELIMINATED';
}

export function getStatusMessage(teamId, standings) {
  const idx = standings.findIndex(t => t.id === teamId);
  if (idx < 0) return '';
  const team = standings[idx];
  const rank = idx + 1;

  const status = getQualificationStatus(teamId, standings);
  const team4 = standings[3];
  const team5 = standings[4];

  if (status === 'QUALIFIED') {
    const isPointsTieWith5 = team5 && team.simPoints === team5.simPoints && rank === 4;
    const msg = isPointsTieWith5 ? ` (tied on points, ahead on NRR)` : ``;
    return `${team.shortName} qualify — ranked #${rank} with ${team.simPoints} pts${msg}`;
  } else if (status === 'ON_THE_EDGE') {
    return `${team.shortName} on the bubble — ranked #${rank} (tied on points, behind on NRR)`;
  } else {
    return `${team.shortName} eliminated — ranked #${rank} with ${team.simPoints} pts`;
  }
}

export function getSimulatedRecord(team) {
  return {
    played: team.played + team.simWon + team.simLost + team.simNR,
    won: team.won + team.simWon,
    lost: team.lost + team.simLost,
    noResult: team.noResult + team.simNR,
  };
}
