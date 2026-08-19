// Real astronomical positioning -- no external astronomy API (those need
// paid keys). Standard formulas: Julian Date -> Greenwich Sidereal Time ->
// Local Sidereal Time -> Hour Angle -> Altitude/Azimuth. J2000 coordinates,
// precession ignored (~<0.5deg drift/decade -- irrelevant at this visual
// scale). This is genuinely computed, not a canned image.

// (name, constellation, RA in HOURS, Dec in DEGREES, apparent magnitude)
export const STAR_CATALOG = [
  // Ursa Major / Big Dipper
  ["Dubhe", "UMa", 11.062, 61.751, 1.79],
  ["Merak", "UMa", 11.031, 56.382, 2.37],
  ["Phecda", "UMa", 11.897, 53.695, 2.44],
  ["Megrez", "UMa", 12.257, 57.033, 3.32],
  ["Alioth", "UMa", 12.900, 55.960, 1.77],
  ["Mizar", "UMa", 13.399, 54.925, 2.23],
  ["Alkaid", "UMa", 13.792, 49.313, 1.86],
  // Ursa Minor / Little Dipper
  ["Polaris", "UMi", 2.530, 89.264, 1.98],
  ["Kochab", "UMi", 14.845, 74.156, 2.08],
  // Orion
  ["Betelgeuse", "Ori", 5.919, 7.407, 0.42],
  ["Rigel", "Ori", 5.242, -8.202, 0.13],
  ["Bellatrix", "Ori", 5.418, 6.350, 1.64],
  ["Mintaka", "Ori", 5.533, -0.299, 2.23],
  ["Alnilam", "Ori", 5.604, -1.202, 1.69],
  ["Alnitak", "Ori", 5.679, -1.943, 1.88],
  ["Saiph", "Ori", 5.796, -9.670, 2.09],
  // Cassiopeia
  ["Schedar", "Cas", 0.675, 56.537, 2.24],
  ["Caph", "Cas", 0.153, 59.150, 2.28],
  ["Tsih", "Cas", 0.945, 60.717, 2.47],
  ["Ruchbah", "Cas", 1.430, 60.235, 2.68],
  ["Segin", "Cas", 1.906, 63.670, 3.35],
  // Cygnus / Northern Cross
  ["Deneb", "Cyg", 20.690, 45.280, 1.25],
  ["Sadr", "Cyg", 20.370, 40.257, 2.23],
  ["Gienah", "Cyg", 20.770, 33.970, 2.48],
  ["Delta Cyg", "Cyg", 19.749, 45.131, 2.87],
  ["Albireo", "Cyg", 19.512, 27.960, 3.18],
  // Lyra
  ["Vega", "Lyr", 18.615, 38.784, 0.03],
  // Leo
  ["Regulus", "Leo", 10.139, 11.967, 1.35],
  ["Denebola", "Leo", 11.818, 14.572, 2.14],
  ["Algieba", "Leo", 10.333, 19.842, 2.28],
  // Scorpius
  ["Antares", "Sco", 16.490, -26.432, 0.96],
  ["Shaula", "Sco", 17.560, -37.104, 1.62],
  ["Sargas", "Sco", 17.622, -42.998, 1.86],
  // Crux / Southern Cross
  ["Acrux", "Cru", 12.443, -63.099, 0.77],
  ["Mimosa", "Cru", 12.795, -59.689, 1.25],
  ["Gacrux", "Cru", 12.519, -57.113, 1.59],
  ["Delta Cru", "Cru", 12.252, -58.749, 2.79],
  // Misc bright standalones
  ["Sirius", "CMa", 6.752, -16.716, -1.46],
  ["Aldebaran", "Tau", 4.599, 16.509, 0.85],
  ["Capella", "Aur", 5.278, 45.998, 0.08],
  ["Castor", "Gem", 7.577, 31.889, 1.58],
  ["Pollux", "Gem", 7.755, 28.026, 1.14],
  ["Arcturus", "Boo", 14.261, 19.182, -0.05],
  ["Spica", "Vir", 13.420, -11.161, 0.98],
];

// Constellation stick-figure lines (by star name) -- only drawn when both
// endpoints are currently above the horizon.
export const CONSTELLATION_LINES = [
  ["Dubhe", "Merak"], ["Merak", "Phecda"], ["Phecda", "Megrez"], ["Megrez", "Dubhe"],
  ["Megrez", "Alioth"], ["Alioth", "Mizar"], ["Mizar", "Alkaid"],
  ["Polaris", "Kochab"],
  ["Betelgeuse", "Bellatrix"], ["Bellatrix", "Mintaka"], ["Mintaka", "Alnilam"],
  ["Alnilam", "Alnitak"], ["Alnitak", "Saiph"], ["Saiph", "Rigel"], ["Rigel", "Mintaka"],
  ["Caph", "Schedar"], ["Schedar", "Tsih"], ["Tsih", "Ruchbah"], ["Ruchbah", "Segin"],
  ["Deneb", "Sadr"], ["Sadr", "Gienah"], ["Sadr", "Delta Cyg"], ["Delta Cyg", "Albireo"],
  ["Acrux", "Gacrux"], ["Mimosa", "Delta Cru"],
  ["Castor", "Pollux"],
];

function toJulianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Greenwich Mean Sidereal Time, in hours.
function gmstHours(jd) {
  const T = (jd - 2451545.0) / 36525;
  let gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  gmst = ((gmst % 360) + 360) % 360;
  return gmst / 15;
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Returns { alt, az } in degrees for a star at (raHours, decDeg) as seen
// from (latDeg, lonDeg) at the given JS Date.
export function altAz(raHours, decDeg, latDeg, lonDeg, date) {
  const jd = toJulianDate(date);
  const lst = (gmstHours(jd) + lonDeg / 15 + 24) % 24;
  let ha = (lst - raHours) * 15; // hour angle, degrees
  ha = rad(ha);
  const dec = rad(decDeg);
  const lat = rad(latDeg);

  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (Math.sin(ha) > 0) az = 2 * Math.PI - az;

  return { alt: deg(alt), az: deg(az) };
}

// Projects all catalog stars currently above the horizon onto a flat dome
// (north up), returning [{ name, con, mag, x, y }] with x/y in [-1, 1]
// (multiply by your radius). Stars below horizon are omitted entirely --
// this is what makes the chart location/time-correct instead of decorative.
export function visibleStars(latDeg, lonDeg, date) {
  const out = [];
  for (const [name, con, ra, decD, mag] of STAR_CATALOG) {
    const { alt, az } = altAz(ra, decD, latDeg, lonDeg, date);
    if (alt <= 0) continue;
    const r = (90 - alt) / 90; // zenith at center, horizon at edge
    const theta = rad(az);
    out.push({ name, con, mag, x: r * Math.sin(theta), y: -r * Math.cos(theta) });
  }
  return out;
}
