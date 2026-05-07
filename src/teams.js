/**
 * Team metadata — colors, logos, etc.
 * These never change during a season.
 */
export const TEAM_COLORS = {
  mi:   { primary: '#004BA0', secondary: '#FFFFFF', textOnPrimary: '#FFFFFF' },
  csk:  { primary: '#F5A800', secondary: '#0B2B6B', textOnPrimary: '#0B2B6B' },
  rcb:  { primary: '#EC1C24', secondary: '#C8A84B', textOnPrimary: '#FFFFFF' },
  kkr:  { primary: '#3B0E7A', secondary: '#F0C030', textOnPrimary: '#F0C030' },
  srh:  { primary: '#FF822A', secondary: '#000000', textOnPrimary: '#FFFFFF' },
  dc:   { primary: '#0078BC', secondary: '#EF1C25', textOnPrimary: '#FFFFFF' },
  pbks: { primary: '#DD1734', secondary: '#A7A9AC', textOnPrimary: '#FFFFFF' },
  rr:   { primary: '#EA1A85', secondary: '#254AA5', textOnPrimary: '#FFFFFF' },
  lsg:  { primary: '#0088CC', secondary: '#FFCC00', textOnPrimary: '#FFFFFF' },
  gt:   { primary: '#1C1C5A', secondary: '#B8860B', textOnPrimary: '#B8860B' },
};

/**
 * Generate an SVG monogram logo for a team.
 * Solid primary color background — no gradient that washes out text.
 */
export function getTeamLogo(teamId, shortName, size = 40) {
  const colors = TEAM_COLORS[teamId] || { primary: '#888', textOnPrimary: '#FFF' };

  // Darken the primary color slightly for the gradient bottom
  const darkerPrimary = darkenHex(colors.primary, 0.25);

  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="lg-${teamId}-${size}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colors.primary}"/>
        <stop offset="100%" stop-color="${darkerPrimary}"/>
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="10" fill="url(#lg-${teamId}-${size})"/>
    <text x="20" y="21" text-anchor="middle" dominant-baseline="central" 
          font-family="'Chakra Petch', sans-serif" font-weight="700" 
          font-size="${shortName.length > 3 ? 10 : 13}" 
          fill="${colors.textOnPrimary}" letter-spacing="0.5">${shortName}</text>
  </svg>`;
}

function darkenHex(hex, amount) {
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
