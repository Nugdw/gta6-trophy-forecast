// gta6-trophy-rarity-forecast-01 entry: "Leonida Curve"
//
// Forecasts, for every Grand Theft Auto VI PS5 trophy, five quantiles of its
// Exophase earn rate at the case's target (the percent of the players Exophase
// tracks who will have earned it), scored by pinball loss on the logit scale.
//
// Method (see MODEL.md for the full reasoning):
//   A rate is earners / players_tracked, and the two move differently, so the
//   program models them separately from the case's recorded history:
//   - players tracked: a log-log least-squares fit (growth decelerates as the
//     launch surge passes), extrapolated to the target;
//   - earners of each trophy: a lognormal completion-time CDF fitted by grid
//     search (the classic shape of "when do players reach this point"), which
//     saturates instead of running away like a straight line;
//   - the median blends that fit with persistence on the logit scale, and the
//     spread combines fit residuals, a random-walk term and an Exophase
//     refresh-staleness term.
// Deterministic: no clock, no randomness, output depends only on the case.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];

interface TrophyMeta {
  id: number;
  name: string;
  description: string;
  tier: string;
  secret: boolean;
}
interface Read {
  at: string;
  players_tracked: number;
  trophies_earned: number;
  rates: Array<number | null>;
}
interface CaseFile {
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  game: { release_date: string };
  trophies: TrophyMeta[];
  history: Read[];
}
interface Snapshot {
  hours: number; // hours since release at this read
  players: number;
  rates: Array<number | null>;
}

const clampPct = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => {
  const p = clampPct(pct);
  return Math.log(p / (100 - p));
};
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

// Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf approximation).
const normCdf = (x: number): number => {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + s * y);
};

// Week-one plausibility caps for a median, from earlier Rockstar / AAA trophy
// data (see MODEL.md): a platinum or a 100%-completion gold inside seven days
// of a 100-hour game is a fraction of a percent (GTA V's sit at 0.1-0.2% after
// years), a story finale lands well under half of tracked players in week
// one, and silver grinds stay in the teens. Applied as a soft squash on the
// logit scale so a strong fit can lean on the cap but not blow through it.
const groupCap = (t: TrophyMeta): number => {
  const d = t.description.toLowerCase();
  if (t.tier === 'platinum') return 1.0;
  if (d.includes('100% completion')) return 1.5;
  if (t.tier === 'gold' && d.includes('final mission')) return 38;
  if (d.startsWith('complete chapter')) return 55;
  if (t.tier === 'silver') return 20;
  return 90;
};
const applyCap = (median: number, cap: number): number => {
  const m = logit(median);
  const lc = logit(cap);
  return m <= lc ? median : invLogit(lc + 0.25 * (m - lc));
};

// Fit earners E(h) = K * Phi((ln(h+1) - mu) / sigma) by grid search over
// (mu, sigma) with K solved by least squares on log earners. Returns the
// fitted earners at the target hour and the fit's log-residual scale.
const fitEarners = (
  pts: Array<{ h: number; e: number }>,
  targetH: number,
  kCap: number,
): { eTarget: number; resid: number; ok: boolean } => {
  if (pts.length < 3) return { eTarget: NaN, resid: 0.6, ok: false };
  const eLast = pts[pts.length - 1].e;
  let best: { sse: number; k: number; mu: number; sigma: number } | null = null;
  for (let mu = -1; mu <= 5.51; mu += 0.25) {
    for (const sigma of [0.7, 1.0, 1.35, 1.8]) {
      const fs = pts.map((p) => Math.max(1e-6, normCdf((Math.log(p.h + 1) - mu) / sigma)));
      let num = 0;
      let den = 0;
      for (let i = 0; i < pts.length; i++) {
        num += Math.log(pts[i].e + 0.5) * fs[i];
        den += fs[i] * fs[i];
      }
      // Solve K in log space approximately: K scales earners multiplicatively,
      // so use the geometric fit K = exp(mean(log(E+0.5) - log(F))) weighted by F.
      let wsum = 0;
      let lsum = 0;
      for (let i = 0; i < pts.length; i++) {
        wsum += fs[i];
        lsum += fs[i] * (Math.log(pts[i].e + 0.5) - Math.log(fs[i]));
      }
      void num;
      void den;
      let k = Math.exp(lsum / wsum) - 0.5;
      if (!(k > 0)) continue;
      if (k < eLast) k = eLast;
      if (k > kCap) k = kCap;
      let sse = 0;
      for (let i = 0; i < pts.length; i++) {
        const pred = Math.log(k * fs[i] + 0.5);
        const obs = Math.log(pts[i].e + 0.5);
        sse += (obs - pred) * (obs - pred);
      }
      if (best === null || sse < best.sse) best = { sse, k, mu, sigma };
    }
  }
  if (best === null) return { eTarget: NaN, resid: 0.6, ok: false };
  const fT = Math.max(1e-6, normCdf((Math.log(targetH + 1) - best.mu) / best.sigma));
  const resid = Math.min(0.85, Math.sqrt(best.sse / pts.length));
  return { eTarget: best.k * fT, resid, ok: true };
};

const forecastCase = (c: CaseFile): { trophies: Array<{ id: number; q: number[] }> } => {
  const releaseMs = Date.parse(`${c.game.release_date}T00:00:00Z`);
  const hoursOf = (iso: string): number => Math.max(0, (Date.parse(iso) - releaseMs) / 3600000);
  const targetH = hoursOf(c.target);
  const horizonDays = c.horizon_minutes / 1440;

  // Collapse consecutive duplicate reads (Exophase had not refreshed between
  // them): keep the last read of each run of identical snapshots.
  const snaps: Snapshot[] = [];
  for (const r of c.history) {
    const snap: Snapshot = { hours: hoursOf(r.at), players: r.players_tracked, rates: r.rates };
    const prev = snaps[snaps.length - 1];
    if (prev && prev.players === snap.players && prev.rates.every((v, i) => v === snap.rates[i])) {
      snaps[snaps.length - 1] = snap;
    } else {
      snaps.push(snap);
    }
  }
  if (snaps.length === 0) throw new Error('case has no history');
  const last = snaps[snaps.length - 1];
  const flat = snaps.length === 1;

  // Players tracked at the target: the tracked base saturates like the
  // earners do (a launch surge, then a long tail of new profiles), so fit the
  // same lognormal CDF family, P(h) = P0 + A * Phi((ln(h+1) - mu) / sigma),
  // with A solved by least squares. A power-law fit would over-extrapolate a
  // saturating base and dilute every rate.
  let pTarget = last.players;
  {
    const p0 = snaps[0].players;
    let best: { sse: number; a: number; mu: number; sigma: number } | null = null;
    if (snaps.length >= 3 && last.players > p0) {
      for (let mu = -1; mu <= 5.51; mu += 0.25) {
        for (const sigma of [0.7, 1.0, 1.35, 1.8]) {
          const fs = snaps.map((s) => Math.max(1e-6, normCdf((Math.log(s.hours + 1) - mu) / sigma)));
          let num = 0;
          let den = 0;
          for (let i = 0; i < snaps.length; i++) {
            num += fs[i] * (snaps[i].players - p0);
            den += fs[i] * fs[i];
          }
          const a = num / den;
          if (!(a > 0)) continue;
          let sse = 0;
          for (let i = 0; i < snaps.length; i++) {
            const d = snaps[i].players - (p0 + a * fs[i]);
            sse += (d * d) / Math.max(1, snaps[i].players);
          }
          if (best === null || sse < best.sse) best = { sse, a, mu, sigma };
        }
      }
    }
    if (best !== null) {
      const pred = p0 + best.a * Math.max(1e-6, normCdf((Math.log(targetH + 1) - best.mu) / best.sigma));
      pTarget = Math.min(Math.max(pred, last.players * 0.95), last.players * 3);
    }
  }

  const trophies = c.trophies.map((t, i) => {
    // Last observed rate for this trophy.
    let rLast: number | null = null;
    for (let j = snaps.length - 1; j >= 0; j--) {
      const v = snaps[j].rates[i];
      if (v !== null && v !== undefined) {
        rLast = v;
        break;
      }
    }
    if (rLast === null) rLast = t.tier === 'platinum' ? 0.3 : t.tier === 'gold' ? 0.6 : t.tier === 'silver' ? 0.8 : 1.0;

    // A trophy pinned at 100% stayed at 100% through the launch refresh.
    if (rLast >= 99.99) {
      return { id: t.id, q: [99.9, 99.95, 99.97, 99.99, 100].map(round4) };
    }

    // Earners series for the CDF fit.
    const pts: Array<{ h: number; e: number }> = [];
    for (const s of snaps) {
      const v = s.rates[i];
      if (v !== null && v !== undefined) pts.push({ h: s.hours, e: (v / 100) * s.players });
    }
    const eLast = pts.length > 0 ? pts[pts.length - 1].e : 0;
    const varied = pts.length >= 3 && eLast > Math.max(1, pts[0].e) * 1.05;

    let median = rLast;
    let resid = 0.6;
    if (flat) {
      // No refresh in the recorded history yet: the snapshot is one cohort.
      // Exophase refreshes in steps, and the next refresh brings a wave of
      // newly tracked players who hold fewer trophies, so rates fall before
      // they climb (on launch night every rate but the 100% one fell when the
      // tracked base went 638 -> 3,868). Dilute the median by the expected
      // earners growth over players growth across the horizon.
      const hh = c.horizon_minutes / 60;
      const gE = 1 + 0.9 * (1 - Math.exp(-hh / 3));
      const gP = 1 + 9 * (1 - Math.exp(-hh / 10));
      const f = Math.min(1.5, Math.max(0.3, gE / gP));
      median = rLast * f;
      resid = 0.85;
    } else if (varied) {
      const fit = fitEarners(pts, targetH, pTarget * 0.98);
      if (fit.ok && fit.eTarget > 0) {
        const rateFit = (100 * fit.eTarget) / pTarget;
        // Blend the structural fit with persistence on the logit scale.
        const w = 0.78;
        median = invLogit(w * logit(rateFit) + (1 - w) * logit(rLast));
        resid = fit.resid;
      }
    }

    // Priors: cap the median at its group's week-one ceiling, and (over a
    // horizon of a day or more, once the tracked base is large) floor it at
    // 40% of the last rate: dilution is bounded because growth decelerates.
    median = applyCap(median, groupCap(t));
    if (horizonDays >= 1 && rLast > 0) median = Math.max(median, Math.min(rLast * 0.4, groupCap(t)));

    const sigma = Math.min(1.35, Math.max(0.38, Math.sqrt(0.42 * 0.42 * horizonDays + resid * resid * 0.36 + 0.22 * 0.22)));
    const m = logit(median);
    return { id: t.id, q: Z.map((z) => round4(invLogit(m + z * sigma))) };
  });

  return { trophies };
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((v, j) => v !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const out = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify(out)}\n`);
}
