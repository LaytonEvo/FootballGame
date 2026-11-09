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

## Phase 2 — Data ingestion ✅

- `DataProvider` interface (`clubs`, `squads`, `fixtures`, `liveMatchStats`, `finalMatchStats`, `transfers`) with
  `FplDatasetProvider` (replays 2025/26 shifted +364 days against the server clock: scheduled → live with
  stats revealed over the match → finished; tests can postpone/abandon fixtures and revise stats) and a
  `CommercialProvider` stub that fails loudly. `DATA_PROVIDER=commercial` selects it.
- `syncReferenceData`: upserts clubs, players, fixtures; creates gameweeks with deadline = first kick-off − 90 min
  and finalisation = 09:00 Europe/London the morning after the last kick-off (DST-safe, tested).
- Jobs (all idempotent, all on the server clock, run together by `tick()`; `worker.ts` schedules it every minute
  via BullMQ when `REDIS_URL` is set, else an in-process loop):
  - `lockDueGameweeks`: fixes the scoring version, snapshots each squad, carries last week's actions over for
    anyone who didn't confirm (Auto-pick fills gaps).
  - `pollLiveGameweeks`: refreshes fixtures, ingests live/final stats (each change bumps a revision and is
    logged in `stat_revisions`), re-scores provisionally from raw stats.
  - `finaliseDueGameweeks`: final pull at 09:00, final scores, status `finalised`. Later revisions are logged
    with `applied = false` and never change scores.
- Postponed/abandoned (or staff-voided) fixtures void the affected players' actions; blank and double gameweeks
  come straight from the real fixture list (GW26 double, GW31 blank) and are tested end to end.
- New config file `config/packs.v0.1.json` (rarity rating bands, squad rating cap 440, pack odds) loaded as a
  third versioned config kind. Odds are working values for the test.

## Phase 3 — Accounts, cards and squads ✅

- Phone sign-in with one-time code: `OtpService` with `TwilioVerifyOtpService` (production, env credentials) and
  `LocalOtpService` (dev/test: code hashed in `otp_challenges`, 10-minute expiry, 5 attempts). Phone numbers
  are normalised to E.164 and stored only as an HMAC (`PHONE_HASH_SECRET`). Bearer-token sessions (hashed).
- Profile: display name, favourite club (content only), 16+ confirmation and disclaimer acceptance are all
  required before any game endpoint (403 `profile_incomplete`). Completing it grants the starter pack once.
- Cards: player, rarity, rating, level, club at opening, active/inactive. Packs are granted sealed (idempotent
  `grant_key`), opened only on request; the server draws with a logged seed and odds version
  (`planPack` is pure, so any opening can be reproduced). Starter: five in squad shape, one tier, one stronger
  card, ≤2 per club, auto-placed. Player, squad, swap and milestone packs implemented. Duplicates level up.
- Squad: shape, ≤2 per club, squad rating cap (config), owned and active cards only. Sub optional.
- Moves: provider transfers are recorded with the first deadline after registration and applied at that
  deadline (before locking). Transfer → card follows the player. Left league / retired → card inactive, out of
  the squad (auto-filled from the collection where possible), free same-rarity swap pack. Returned → reactivated
  (owner keeps the swap pack). `relegateClub` / `promoteClub` for season end.

## Assumptions to confirm

| #   | Rule                                     | What the build does now                                                                                                       | Where               |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| A1  | Captain on a starter who plays 0 minutes | Captaincy is lost (no vice-captain); the sub scores its own actions without ×2                                                | `scoreSquad`        |
| A2  | Bold-miss penalty and multipliers        | Penalty = −ceil(base × 50%), not scaled by rarity or captain                                                                  | `scoreSquad`        |
| A3  | Rounding                                 | Per action line, half away from zero, so the breakdown always sums to the total                                               | `scoreSquad`        |
| A4  | Double gameweek "combined stats"         | Thresholds use summed stats (so "Plays 90" lands on 45+45; clean sheet lands if either match is one) — same as the Python sim | `aggregate`         |
| A5  | Postponed after lock                     | Player's actions void; the sub may come in (treated like 0 minutes)                                                           | `scoreSquad`        |
| A6  | Two starters out                         | Only one sub; it comes in once any starter is out                                                                             | `scoreSquad`        |
| A7  | Chaos cap scope                          | "Max one per squad" counts the sub's actions too                                                                              | `validateSelection` |
| A8  | Overlap                                  | Follows config groups exactly: `assist` + `goal_involvement` is allowed (different groups)                                    | config              |
| A9  | Negative weeks                           | Season Points can go negative (bold misses); Coins earned are floored at 0 per week                                           | ledger              |
