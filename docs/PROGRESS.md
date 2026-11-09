# Progress

One short note per phase. Assumptions that need a product decision are collected at the bottom.

## Phase 0 — Repo and tooling ✅

- pnpm + Turborepo monorepo: `apps/api` (Fastify), `apps/mobile` (Expo SDK 58, Expo Router), `packages/shared`
  (domain types, zod schemas for the config files), `packages/scoring` (pure engine), `packages/fpl-dataset`
  (loader for the committed 2025/26 snapshot, dev/replay only).
- TypeScript strict everywhere (`noUncheckedIndexedAccess` on), ESLint flat config + Prettier, CI in
  `.github/workflows/ci.yml` (lint, format check, typecheck, tests).
- Database: Postgres via Drizzle. `DATABASE_URL=postgres://…` uses node-postgres; without it the API uses an
  embedded PGlite (real Postgres compiled to WASM) under `apps/api/.data/`, and tests use in-memory PGlite, so
  `pnpm dev` and CI need no services. Migrations in `apps/api/drizzle/` run on start.
- `pnpm seed` loads `config/scoring.v0.2.json` and `config/economy.v0.1.json` into `config_versions`
  (idempotent, versioned per season, one active per kind). Switching the active version needs no release.
- `pnpm dev` starts the API on :3000 and the Expo dev server on :8081. Metro is configured to resolve the
  workspace packages' `.js`-suffixed TS imports.
- Dataset: `pnpm data:fetch` trims the public vaastav 2025/26 files into `data/fpl-2025-26/*.csv.gz` (committed,
  560 KB) so replay tests run offline. Nothing calls fantasy.premierleague.com.

## Phase 1 — Scoring engine + season replay ✅

- `packages/scoring`: `compileRules(config)` → `validateSelection` → `scoreSquad(rules, selection, stats)` →
  line-by-line breakdown ("Assist landed: 15 × 1.0 rarity × 2 bold = 30"). Pure, deterministic, versioned
  (`rulesVersion` on every score). Also `autoPick`, `carryOver` (same as last week / missed deadline),
  `formHint` ("3+ saves in 3 of last 5"), `potentialPoints`, seeded RNG.
- Covered by unit tests: overlap groups, 1–2 actions per player, captain ×2, bold ×2 / −50% rounded up, max one
  chaos per squad (sub included), rarity multipliers, sub rule, blank and double gameweeks, clean sheet 60+
  minutes, postponed/abandoned voids, live pending/landed/missed states, red cards, advanced-feed gating.
- Replay (`pnpm replay`, `pnpm economy-check`) ports `tools/sim/sim.py` (same pool and tier proxy) but scores
  every gameweek through the production engine, and adds captain, bold, rarity multipliers, a substitute and
  persistent squads. Repeat runs are identical (tested).
- `docs/ECONOMY_CHECK.md`: prices 100/60/400 give ≈1.2 cards per gameweek including the weekly free pack —
  keep them. Milestones 250/500/750/1000 are too high for a casual player (reaches 2 of 4); proposed
  200/400/550/750. Elite-vs-Bronze gap is 1.18× (spec says ≈1.10×). Config files are **not** changed until the
  product owner decides.

## Assumptions to confirm

| # | Rule | What the build does now | Where |
| --- | --- | --- | --- |
| A1 | Captain on a starter who plays 0 minutes | Captaincy is lost (no vice-captain); the sub scores its own actions without ×2 | `scoreSquad` |
| A2 | Bold-miss penalty and multipliers | Penalty = −ceil(base × 50%), not scaled by rarity or captain | `scoreSquad` |
| A3 | Rounding | Per action line, half away from zero, so the breakdown always sums to the total | `scoreSquad` |
| A4 | Double gameweek "combined stats" | Thresholds use summed stats (so "Plays 90" lands on 45+45; clean sheet lands if either match is one) — same as the Python sim | `aggregate` |
| A5 | Postponed after lock | Player's actions void; the sub may come in (treated like 0 minutes) | `scoreSquad` |
| A6 | Two starters out | Only one sub; it comes in once any starter is out | `scoreSquad` |
| A7 | Chaos cap scope | "Max one per squad" counts the sub's actions too | `validateSelection` |
| A8 | Overlap | Follows config groups exactly: `assist` + `goal_involvement` is allowed (different groups) | config |
| A9 | Negative weeks | Season Points can go negative (bold misses); Coins earned are floored at 0 per week | ledger |
