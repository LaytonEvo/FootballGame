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

## Phase 4 — Picking actions ✅ (usability run still to do with real testers)

- API: `GET /picks` (slots with "v ARS (H)" fixture context, every basic-feed action grouped by tier with
  points and a form hint like "3+ saves in 3 of last 5", current selection, potential points),
  `POST /picks/suggest` (`last_week` / `auto`), `POST /picks/:gw/confirm` (validated by the same engine;
  re-confirm allowed until the deadline; **409 `locked` from the deadline on, using the server clock only**).
  Confirming unlocks that week's free player pack once. `GET /home` aggregates the Home screen.
- Missed deadline: last week's actions carry over at lock (tested), with Auto-pick filling new players.
- Mobile (Expo Router): sign-in → code → profile (16+, disclaimer, privacy summary) → sealed starter pack →
  reveal → guided pick screen (opens the striker's sheet) → Auto-pick → captain → Confirm → Home countdown.
  Pitch view (FWD, MID MID, DEF, GK, sub strip), kit-style shirts in rarity colours (no crests or kits),
  action sheet grouped Likely / Possible / Bold / Long shot / Chaos with "+N pts", hints, captain switch and
  bold toggle ("double if it lands, −N if not"); long-press a chip to mark bold. Theme from `design/tokens.json`.
- Pick-state logic (`apps/mobile/src/features/picks/state.ts`) is pure and unit-tested; it reuses
  `@ff/scoring` so the client shows the same validation and potential points as the server.
- Verified in headless Chromium against the real API and the replayed dataset (`apps/mobile/e2e/onboarding.cjs`):
  phone → confirmed actions with no console errors; screenshots in `docs/screenshots/`. The "<60 s for a
  returning player" target needs a real usability run on devices: returning players need two taps
  (Same as last week → Confirm).
- Analytics: `pick_started` and `actions_confirmed` (with server-measured `pickMs`).

## Phase 5 — Live matchday and notifications ✅

- Home switches to live mode once a gameweek is locked: pitch with a points bubble per shirt, each action chip
  pending / landed / missed / void (icon + colour), live score and minute on the name plate ("1–0 · 62’",
  half-time aware), the last landed action as a banner, provisional banner until 09:00, and live mini-league
  movement (filled in by Phase 6). The next deadline's countdown stays on Home during a live gameweek.
- Notifications are queued in `notifications` (idempotent dedupe keys, every user switch respected and kept
  as `suppressed = pref_off` for audit) and delivered each tick through `PushSender` (Expo push service in
  production; in-memory in tests): deadline reminders 24h and 2h only if not confirmed; actions carried over;
  action landed (held one minute and merged into one push per user); recap ready; card changed club /
  inactive (grouped per batch); new pack (max one a day, extras suppressed `daily_cap`); mini-league overtaken
  (off by default). No marketing pushes. Tapping a push opens its screen.
- `PUT /me/notifications`, `POST /me/push-token`; switches on the Profile tab.
- Test `test/live.test.ts` replays GW1 on a fake clock and checks every push, its timing, batching, the
  per-user switch and the live Home payload. For staging: `pnpm --filter @ff/api replay:gameweek --gw 12`
  drives one gameweek through every job on a fake clock against a staging database and prints the timeline.

## Phase 6 — Leagues ✅

- Tables are computed from `gameweek_scores` (provisional included, so they move live): Global (season,
  month `?view=month&month=2026-10`, week), private mini-leagues (Season / This week). Ranking: points, then
  most actions landed, then fewest actions picked; exact ties share a rank (unit-tested). Movement arrows
  compare with the table before the latest gameweek.
- Mini-leagues: create → invite code + `https://…/join/CODE` and `fantasyfive://join/CODE` links → public
  preview `GET /invites/:code` → join (idempotent, case-insensitive) → leave. Non-members get 403.
- Deep link: `/join/[code]` stores the code; after onboarding's starter pack the player lands in that league
  (with a "Pick your actions" card). Analytics: `league_created`, `invite_link_opened`, `league_joined`,
  `invite_accepted`.
- Home league card (rank, size, gap to the place above) and live mini-league movement during matches;
  "Overtaken in a mini-league" push after finalisation (off by default).
- "My season" (`GET /me/season`): total, average, best week, bars per gameweek with league-average marks,
  last three weeks.
- Test: create, invite by link, join, replay GW1 and GW2, tables match the stored scores, arrows correct.

## Phase 7 — Coins, packs and rewards ✅

- `coin_ledger` is append-only with a unique idempotency key per row; balance = `sum(amount)` (no balance
  column). Finalisation credits 1 Coin per point once per gameweek (`gw:<gw>:<user>`); a negative week earns 0.
- Shop: player pack 100, card swap 60, squad pack 400 (from the active economy config). Purchases need an
  `Idempotency-Key`, run in a transaction with a row lock on the user, refuse when short, and a retry returns
  the same pack. Swap: the card leaves the collection (`swapped`), a same-rarity swap pack is granted, the
  squad auto-fills.
- Weekly free pack: unlocked by confirming that week's actions (Phase 4). Season milestones from config are
  granted as packs exactly once per season (grant keys) after each finalisation.
- Pack odds come from `config/packs.v0.1.json`, are shown on every pack and in the shop, and are logged with
  the seed on each opening.
- Home Coins chip with a progress bar to the next pack; Coins & packs screen (Coins vs Season Points, next-pack
  progress, milestone track, weekly free pack, shop with odds). Pack opening animation follows the token
  motion spec with Skip and Reduce Motion (fade only); no near-miss effects.
- Test: ledger reconciles to balance through earn, buy (and retry), squad pack, swap, insufficient funds;
  milestones grant once; odds logged and shown.

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
