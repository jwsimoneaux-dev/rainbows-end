/**
 * Rainbow's End Sailboat Calculator — the engine.
 *
 * Pure functions, no DOM, so an app can carry the same file later. Every input
 * and output is imperial (ft, ft², lb, gal, kt); the page converts for metric.
 * Each calculation returns its value with the math that produced it, so the
 * page can show every step (spec 4.5, "Show the math").
 *
 * Constants follow D2 (Jerry, 2026-10-08): one consistent set, 2/3 in SA/D and
 * 64 lb/ft³ seawater everywhere, and each author's own exponent (Brewer's
 * beam^(4/3) in the comfort ratio, which reproduces Rainbow's published 36.6).
 */

export const K = {
  SEA_LB_FT3: 64,
  FRESH_LB_FT3: 62.4,
  WATER_LB_GAL: 8.34,
  FUEL_LB_GAL: { diesel: 7.1, gasoline: 6.1 },
  PERSON_LB: 175,          // D4
  STORES_LB_PER_DAY: 4,    // D4, per person-day
  CWP: 0.67,               // waterplane coefficient for pounds per inch
  SHEET_K: 0.00431,        // the deck-hardware rule of thumb, lb per ft² per kt²
  SHAFT_FACTOR: 0.95,      // Gerr (2011): a direct shaft delivers 95-96% of brake hp to the prop
  // Gerr: gal/h = 0.054 × hp at the propeller (diesel), via Practical Sailor,
  // 'Determining a Fuel-efficient Engine RPM', 2025. Gasoline still unsourced.
  FUEL_GAL_PER_HP_H: { diesel: 0.054, gasoline: 0.10 },
  RESERVE: 1 / 3,          // D15: Practical Sailor's rule of thirds
  LINE_SAFETY: 5,          // D7
  HANDLE_PULL_LB: 40,      // D8
  GERR_POWER: 10.665,      // Our estimate (D21): attributed to Gerr, not read at a source
  GERR_SAIL: 8.26,         // Gerr, 'What Efficiency Means', Part 1 (2011)
};

const r = (x, d = 2) => (Number.isFinite(x) ? Number(x.toFixed(d)) : NaN);
const ok = (...xs) => xs.every((x) => Number.isFinite(x) && x > 0);
const n = (x) => (Number.isFinite(x) ? x : 0);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : '—');

/** Decimals the page prints for each banded figure. */
export const SHOWN = { sad: 1, dl: 0, comfort: 1, capsize: 2, bruce: 2, sf: 1 };

/* ── Bands (spec 4.1, 4.2). The reading text lives on the page; these are keys. ── */

export function band(key, v) {
  if (!Number.isFinite(v)) return null;
  switch (key) {
    // SA/D and D/L bands: Ralph Naranjo, 'Measuring Performance', Practical Sailor, 2020.
    case 'sad': return v < 15 ? 'under' : v < 18 ? 'good' : v <= 20 ? 'excellent' : 'handful';
    case 'dl': return v < 90 ? 'ultralight' : v < 180 ? 'light' : v < 270 ? 'moderate' : v <= 360 ? 'heavy' : 'ultraheavy';
    // Brewer put moderate, successful ocean cruisers in the low to mid 30s
    // (Jamie Gifford, Cruising World, 2026, quoting Brewer). D20.
    case 'comfort': return v < 30 ? 'quick' : v <= 35 ? 'ocean' : 'calm';
    case 'capsize': return v < 2 ? 'meets' : 'fails';
    case 'bruce': return v < 1 ? 'slow' : v <= 1.3 ? 'cruiser' : 'quick';
    // Practical Sailor, 'Multihull Capsize Risk Check', 2021: an offshore cruiser
    // should not need reefing below 22-25 kt apparent.
    case 'sf': return v < 22 ? 'early' : v < 25 ? 'edge' : 'offshore';
    // The same article: optimum length to beam 1.7-2.2 for cats, 1.2-1.8 for tris.
    default: return null;
  }
}

/* ── The rig ── */

export function sailAreas({ I, J, P, E, Pm, Em, lp } = {}) {
  const fore = ok(I, J) ? 0.5 * I * J : NaN;
  const main = ok(P, E) ? 0.5 * P * E : NaN;
  const mizzen = ok(Pm, Em) ? 0.5 * Pm * Em : 0;
  const forestay = ok(I, J) ? Math.hypot(I, J) : NaN;
  const total = Number.isFinite(fore) && Number.isFinite(main) ? fore + main + mizzen : NaN;
  // Headsail at LP%: a triangle on the forestay with height LP (spec 4.3; estimate).
  const lpFt = ok(J, lp) ? (J * lp) / 100 : NaN;
  const headsail = Number.isFinite(forestay) && Number.isFinite(lpFt) ? 0.5 * forestay * lpFt : NaN;
  return { fore, main, mizzen, total, forestay, headsail, lpFt };
}

/** The sail area every ratio uses: the published figure, or the rig's 100% total. */
export function sailAreaFor(boat) {
  if (ok(boat.sa)) return { sa: boat.sa, from: 'published' };
  const t = sailAreas(boat).total;
  return Number.isFinite(t) ? { sa: t, from: 'rig' } : { sa: NaN, from: 'none' };
}

/* ── The load (spec 4.1) ── */

export function addedLoad(l = {}) {
  const personLb = ok(l.personLb) ? l.personLb : K.PERSON_LB;
  const storesLb = ok(l.storesLbPerDay) ? l.storesLbPerDay : K.STORES_LB_PER_DAY;
  const fuelLbGal = K.FUEL_LB_GAL[l.fuelType] ?? K.FUEL_LB_GAL.diesel;
  const parts = [
    { key: 'water', lb: n(l.waterGal) * K.WATER_LB_GAL, math: `${fmt(n(l.waterGal))} gal × ${K.WATER_LB_GAL} lb/gal` },
    { key: 'fuel', lb: n(l.fuelGal) * fuelLbGal, math: `${fmt(n(l.fuelGal))} gal × ${fuelLbGal} lb/gal` },
    { key: 'persons', lb: n(l.persons) * personLb, math: `${fmt(n(l.persons), 0)} × ${personLb} lb` },
    { key: 'stores', lb: n(l.persons) * n(l.days) * storesLb, math: `${fmt(n(l.persons), 0)} persons × ${fmt(n(l.days), 0)} days × ${storesLb} lb` },
    { key: 'dinghy', lb: l.dinghyAboard === false ? 0 : n(l.dinghyLb), math: l.dinghyAboard === false ? 'not aboard' : `${fmt(n(l.dinghyLb), 0)} lb` },
    { key: 'gear', lb: n(l.gearLb), math: `${fmt(n(l.gearLb), 0)} lb` },
  ];
  const total = parts.reduce((s, p) => s + p.lb, 0);
  return { total, parts };
}

/* ── The ratios ── */

export const sad = (sa, disp) => (ok(sa, disp) ? sa / Math.pow(disp / K.SEA_LB_FT3, 2 / 3) : NaN);
export const dl = (disp, lwl) => (ok(disp, lwl) ? disp / 2240 / Math.pow(0.01 * lwl, 3) : NaN);
export const ballastRatio = (ballast, disp) => (ok(ballast, disp) ? (ballast / disp) * 100 : NaN);
export const comfort = (disp, lwl, loa, beam) =>
  ok(disp, lwl, loa, beam) ? disp / (0.65 * (0.7 * lwl + 0.3 * loa) * Math.pow(beam, 4 / 3)) : NaN;
export const capsize = (beam, disp) => (ok(beam, disp) ? beam / Math.cbrt(disp / K.SEA_LB_FT3) : NaN);
export const hullSpeed = (lwl) => (ok(lwl) ? 1.34 * Math.sqrt(lwl) : NaN);
// Gerr (2011): max SL = 8.26 / (D/L)^0.311, "but never less than 1.34".
export const gerrSLmax = (dlv) => (ok(dlv) ? Math.max(1.34, K.GERR_SAIL / Math.pow(dlv, 0.311)) : NaN);
export const bruce = (sa, disp) => (ok(sa, disp) ? Math.sqrt(sa) / Math.cbrt(disp) : NaN);

/** Pounds per inch immersion. hulls = number of hulls in the water at rest. */
export function ppi(lwl, beam, water = 'salt', hulls = 1) {
  if (!ok(lwl, beam)) return NaN;
  const rho = water === 'fresh' ? K.FRESH_LB_FT3 : K.SEA_LB_FT3;
  return (lwl * beam * K.CWP * rho * hulls) / 12;
}

/**
 * Every ratio for one displacement. boat: { hull, loa, lwl, beam, ballast,
 * sa (resolved), water, hullBeam }. Returns figures keyed by id, each with a
 * value, a band key and its math lines.
 */
export function ratios(boat, disp) {
  const { lwl, loa, beam, ballast, sa, water = 'salt' } = boat;
  const multi = boat.hull === 'catamaran' || boat.hull === 'trimaran';
  const out = {};
  // A band follows the figure as the page prints it, so 15.98 shown as 16.0
  // never reads as under 16.
  const put = (id, value, bandKey, math) => (out[id] = { value, band: bandKey ? band(bandKey, r(value, SHOWN[bandKey])) : null, math });

  const vSad = sad(sa, disp);
  put('sad', vSad, 'sad', [
    'SA ÷ (Disp ÷ 64)^(2/3)',
    `${fmt(sa, 1)} ÷ (${fmt(disp, 0)} ÷ 64)^(2/3)`,
    `${fmt(sa, 1)} ÷ ${fmt(Math.pow(disp / 64, 2 / 3))} = ${fmt(vSad)}`,
  ]);
  const vDl = dl(disp, lwl);
  put('dl', vDl, 'dl', [
    '(Disp ÷ 2240) ÷ (0.01 × LWL)³',
    `(${fmt(disp, 0)} ÷ 2240) ÷ (0.01 × ${fmt(lwl)})³`,
    `${fmt(disp / 2240, 3)} ÷ ${fmt(Math.pow(0.01 * lwl, 3), 5)} = ${fmt(vDl, 1)}`,
  ]);
  const sl = gerrSLmax(vDl);
  put('hull', hullSpeed(lwl), null, ['1.34 × √LWL', `1.34 × √${fmt(lwl)} = ${fmt(hullSpeed(lwl))} kt`]);
  put('gerr', sl * Math.sqrt(lwl), null, [
    'SL = 8.26 ÷ (D/L)^0.311, never less than 1.34; speed = SL × √LWL',
    `SL = 8.26 ÷ ${fmt(vDl, 1)}^0.311 = ${fmt(sl, 3)}`,
    `${fmt(sl, 3)} × √${fmt(lwl)} = ${fmt(sl * Math.sqrt(lwl))} kt`,
  ]);

  if (multi) {
    const vB = bruce(sa, disp);
    put('bruce', vB, 'bruce', ['√SA ÷ Disp^(1/3)', `√${fmt(sa, 1)} ÷ ${fmt(disp, 0)}^(1/3)`, `${fmt(Math.sqrt(sa))} ÷ ${fmt(Math.cbrt(disp))} = ${fmt(vB)}`]);
  } else {
    const vBal = ballastRatio(ballast, disp);
    put('ballast', vBal, null, ['Ballast ÷ Disp × 100', `${fmt(ballast, 0)} ÷ ${fmt(disp, 0)} × 100 = ${fmt(vBal, 1)}%`]);
    const vC = comfort(disp, lwl, loa, beam);
    put('comfort', vC, 'comfort', [
      'Disp ÷ (0.65 × (0.7 LWL + 0.3 LOA) × Beam^(4/3))',
      `${fmt(disp, 0)} ÷ (0.65 × (0.7 × ${fmt(lwl)} + 0.3 × ${fmt(loa)}) × ${fmt(beam)}^(4/3))`,
      `${fmt(disp, 0)} ÷ ${fmt(0.65 * (0.7 * lwl + 0.3 * loa) * Math.pow(beam, 4 / 3), 1)} = ${fmt(vC, 1)}`,
    ]);
    const vCs = capsize(beam, disp);
    put('capsize', vCs, 'capsize', ['Beam ÷ (Disp ÷ 64)^(1/3)', `${fmt(beam)} ÷ (${fmt(disp, 0)} ÷ 64)^(1/3)`, `${fmt(beam)} ÷ ${fmt(Math.cbrt(disp / 64))} = ${fmt(vCs)}`]);
  }

  const hulls = boat.hull === 'catamaran' ? 2 : 1;
  const ppiBeam = multi ? boat.hullBeam : beam;
  const vP = ppi(lwl, ppiBeam, water, hulls);
  const rho = water === 'fresh' ? K.FRESH_LB_FT3 : K.SEA_LB_FT3;
  put('ppi', vP, null, [
    `LWL × ${multi ? 'hull beam' : 'Beam'} × ${K.CWP} × ${rho} ÷ 12${hulls > 1 ? ' × 2 hulls' : ''}`,
    `${fmt(lwl)} × ${fmt(ppiBeam)} × ${K.CWP} × ${rho} ÷ 12${hulls > 1 ? ' × 2' : ''} = ${fmt(vP, 0)} lb/in`,
  ]);
  return out;
}

/* ── Multihull figures that don't change with load (spec 4.2) ── */

/**
 * Wind to lift a hull, kt: Practical Sailor's stability factor ('Multihull
 * Capsize Risk Check', 2021), 9.8 × √(0.5 × BCL × D ÷ (SA × HCOE)), where BCL is
 * the beam between hull centerlines (overall beam less one hull's beam). It
 * includes a 40% gust factor and assumes flat water.
 */
export function stabilityFactor({ beam, hullBeam, disp, sa, hcoe }) {
  if (!ok(beam, hullBeam, disp, sa, hcoe) || hullBeam >= beam) return { value: NaN, math: [] };
  const bcl = beam - hullBeam;
  const v = 9.8 * Math.sqrt((0.5 * bcl * disp) / (sa * hcoe));
  return {
    value: v,
    band: band('sf', r(v, SHOWN.sf)),
    math: [
      '9.8 × √(0.5 × BCL × Disp ÷ (SA × HCOE)); BCL = beam − hull beam',
      `BCL = ${fmt(beam)} − ${fmt(hullBeam)} = ${fmt(bcl)}`,
      `9.8 × √(0.5 × ${fmt(bcl)} × ${fmt(disp, 0)} ÷ (${fmt(sa, 1)} × ${fmt(hcoe, 1)})) = ${fmt(v, 1)} kt`,
    ],
  };
}

export function multihull({ hull, loa, lwl, beam, hullBeam, bridgedeck, disp, sa, hcoe }) {
  const fineness = ok(lwl, hullBeam) ? lwl / hullBeam : NaN;
  const clearanceShare = ok(bridgedeck, beam) ? (bridgedeck / beam) * 100 : NaN;
  const lb = ok(loa, beam) ? loa / beam : NaN;
  const [lo, hi] = hull === 'trimaran' ? [1.2, 1.8] : [1.7, 2.2];
  return {
    sf: stabilityFactor({ beam, hullBeam, disp, sa, hcoe }),
    lengthBeam: {
      value: lb, range: [lo, hi],
      band: Number.isFinite(lb) ? (r(lb, 2) < lo ? 'wide' : r(lb, 2) > hi ? 'narrow' : 'within') : null,
      math: ['LOA ÷ overall beam', `${fmt(loa)} ÷ ${fmt(beam)} = ${fmt(lb)}`],
    },
    fineness: { value: fineness, math: ['hull LWL ÷ hull beam', `${fmt(lwl)} ÷ ${fmt(hullBeam)} = ${fmt(fineness, 1)}`] },
    clearance: { value: clearanceShare, math: ['clearance ÷ overall beam × 100', `${fmt(bridgedeck)} ÷ ${fmt(beam)} × 100 = ${fmt(clearanceShare, 1)}%`] },
  };
}

/* ── Sheet and halyard loads (spec 4.3) ── */

export const sheetLoad = (area, kt) => (ok(area, kt) ? area * kt * kt * K.SHEET_K : NaN);

/**
 * The breaking strength a line needs: the load × 5. The Cordage Institute puts
 * a line's safe working load at 1/5 to 1/12 of its breaking strength (via
 * Practical Sailor, November 2010); 5 is the low end. No diameter is suggested:
 * no sourced table covers it, and makers' figures differ by line.
 */
export function lineFor(load) {
  if (!ok(load)) return null;
  return { need: load * K.LINE_SAFETY };
}

export const powerRatio = (load) => (ok(load) ? load / K.HANDLE_PULL_LB : NaN);

/* ── Range under power (spec 4.4) ── */

export function range({ disp, lwl, hp, tankGal, reserve = K.RESERVE, fuel = 'diesel' }) {
  if (!ok(disp, lwl, hp)) return null;
  const shp = hp * K.SHAFT_FACTOR;
  const slPower = K.GERR_POWER / Math.cbrt(disp / shp);
  const slMax = gerrSLmax(dl(disp, lwl));
  const slTop = Math.min(slPower, slMax);
  const limit = slPower <= slMax ? 'power' : 'hull';
  const gphPerHp = K.FUEL_GAL_PER_HP_H[fuel] ?? K.FUEL_GAL_PER_HP_H.diesel;
  const usable = ok(tankGal) ? tankGal * (1 - reserve) : NaN;
  const row = (sl, top = false) => {
    const kt = sl * Math.sqrt(lwl);
    const hpAt = (disp * sl ** 3) / (K.GERR_POWER ** 3);
    const gph = hpAt * gphPerHp;
    const nmpg = kt / gph;
    return { sl, kt, hp: hpAt, gph, nmpg, range: usable * nmpg, top };
  };
  const rows = [0.9, 1.0, 1.1, 1.2].filter((s) => s < slTop - 0.01).map((s) => row(s));
  rows.push(row(slTop, true));
  // "Fuel climbs fast past here": the first row above 75% of hull speed.
  // Practical Sailor (2025): an efficient cruising speed is 60-70% of hull
  // speed, and past 75% drag greatly increases.
  const hs = hullSpeed(lwl);
  const steep = rows.findIndex((x) => x.kt > 0.75 * hs + 0.005);
  return {
    shp, slPower, slMax, slTop, limit, usable, rows, steep, efficient: [0.6 * hs, 0.7 * hs],
    math: [
      `shaft hp = ${fmt(hp, 0)} × ${K.SHAFT_FACTOR} = ${fmt(shp, 1)}`,
      `SL from power = 10.665 ÷ (${fmt(disp, 0)} ÷ ${fmt(shp, 1)})^(1/3) = ${fmt(slPower, 3)}`,
      `Gerr's SL max = ${fmt(slMax, 3)}; top SL = ${fmt(slTop, 3)} (${limit === 'power' ? 'limited by the engine' : 'limited by the hull'})`,
      `hp at a speed = Disp × SL³ ÷ 1213.06`,
      `fuel = hp × ${gphPerHp} gal per hp-hour`,
      `usable fuel = ${fmt(tankGal, 0)} gal × (1 − ${fmt(reserve * 100, 0)}%) = ${fmt(usable, 1)} gal`,
    ],
  };
}

export { r as round };
