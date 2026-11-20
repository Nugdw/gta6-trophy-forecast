# Leonida Curve — how the forecast is built

The program (`main.ts`) reads one case — every read the house recorded of
GTA VI's Exophase trophy page before the checkpoint — and writes, for each of
the 55 trophies, five quantiles of its earn rate at the target: the percent of
the players Exophase tracks who will have earned it.

## A rate is two curves, not one

An earn rate is `earners / players_tracked`, and the two move differently:

- **Earners accumulate along a completion-time curve.** Players reach a given
  trophy at very different times; the cumulative count of earners is the CDF
  of that reaching-time distribution, which for game progress is close to
  lognormal in hours played. The program fits, per trophy,
  `E(h) = K * Phi((ln(h+1) - mu) / sigma)` by grid search over `(mu, sigma)`
  with `K` solved by least squares on log earners. A saturating CDF is the
  crucial difference from a straight-line trend: a line fitted to two frantic
  launch days extrapolates story trophies to absurd levels by day seven,
  while the CDF bends over as the pool of players who will ever reach that
  point in week one runs out.
- **The tracked base grows and decelerates.** `players_tracked` jumped
  638 -> 3,868 in one launch-night refresh and keeps growing as more owners
  sync a profile, fastest right after launch and over the first weekend. The
  program fits the same saturating CDF family to the player count, so the
  denominator grows without running away (a power-law fit over-extrapolates a
  saturating base and dilutes every rate).
- **Exophase refreshes in steps.** The page sat unchanged for hours on launch
  night, then every rate but the one at 100% dropped at once when the base
  refreshed: newly tracked players hold fewer trophies. The answer is the
  page as of its last refresh before the target, so the spread carries a
  refresh-staleness term (0.22 logit) on top of the fit residuals and a
  random-walk term (0.42 per root-day). When a case's history is a single
  un-refreshed snapshot, the median is diluted by expected earners growth
  over players growth across the horizon instead of pretending the rate
  stands still.

The median blends the structural fit with persistence (78/22 on the logit
scale) so a trophy whose earners barely move is not dragged by a noisy fit.

## What earlier games say (the priors)

The caps below are soft squashes on the median, from how trophy curves of
comparable games actually look:

- **GTA V (PlayStation, tracker cohorts):** the first story trophy
  ("Welcome to Los Santos") sits at ~39% of tracked owners *after years*;
  the final-mission trophy at ~7% in one tracker sample and ~29% in
  PSN-wide reporting; the platinum at 0.1%; 100% completion ("Career
  Criminal") and 70 gold medals at 0.2%. A week is a fraction of "ever".
- **AAA story games generally:** an October 2026 audit of 100 story-driven
  games (RageQuit.gg, from platform achievement data) puts the *median
  all-time* story completion at ~33% of owners; even celebrated linear
  games top out near half. Exophase's tracked cohort skews engaged — they
  bother to sync a profile — so week-one rates sit above all-owner rates,
  but the ordering and the ceilings hold.
- **Platinum / 100% grinds are the extreme tail.** A 100-hour open world is
  not completed 100% in seven days by any measurable share of players.

## The six groups of this trophy list

1. **Platinum — "Vice Got a Price!" (id 1).** Requires everything below,
   including 100% completion and every grind. Week one: a few tenths of a
   percent at most. Cap 1.0%.
2. **The story spine — chapters 1–4 (ids 3–6), the final mission (id 7,
   gold), and the named-mission bronzes (ids 2, 8–13).** These climb
   fastest: the engaged launch cohort plays the story first. Chapter 1
   leads, each later chapter trails the one before, and the finale — the
   end of a long open-world campaign — reaches only the committed share in
   week one (cap 38%; chapters cap 55%). "Just Like Paradise" (id 2) was
   already at 100% in the pre-release snapshot and stayed there through the
   first refresh, so it is forecast pinned at ~100%.
3. **100% completion — "A Long Road" (id 14, gold).** GTA V's equivalent
   trophy is 0.2% after years. Week one is far below that: cap 1.5%.
4. **Side-strand finales and stranger strands (ids 22–24, 26, 27; id 25,
   silver).** Optional story content: follows the story pace at a discount,
   since many players mainline the campaign first.
5. **Grinds and collectibles (ids 15, 17–19, 28, 30–32, 35, 42, 52–55).**
   250 stunts, gold medals on every shooting-range challenge, 100 WAiNK
   spots, every meditation spot, $250k laundered: pure hours. They grow
   steadily with total play time but stay low in week one; the silvers are
   capped at 20%.
6. **One-off feats and secret story moments (ids 16, 20, 21, 29, 33, 34,
   36–41, 43–51).** Two sub-shapes: incidental feats (rob a shop undetected,
   discover vehicles) pop early for explorers and then plateau, while the
   secret bronzes tied to story beats track the story curve of group 2 at
   their point in the campaign.

## Scoring honesty

The contest scores pinball loss on the logit scale, where a miss from 1% to
2% costs what a miss from 33% to 50% costs: the rare trophies count as much
as the common ones. That is why the caps and the saturating fits matter —
the forecast's job is to be *calibrated* on all 55 trophies at once, not to
nail the chapter trophies and wave at the tail.
