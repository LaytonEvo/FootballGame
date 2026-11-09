# Fantasy Five — build brief for Claude Code

Working title. A season-long, 5-a-side Premier League fantasy game for mobile. Players open packs to get a squad of five (GK, DEF, MID, MID, FWD plus one sub), pick one or two **scoring actions** per player each gameweek (goal, assist, clean sheet, 3+ tackles…), and score points when those actions happen in the real match. Points build a season-long league score; Coins earned from points buy more packs.

This repo starts empty apart from this handoff. Build the **MVP for a closed test** described below, in phases, with tests passing at the end of each phase.

## Read these first

| File                       | What it is                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `docs/SPEC.md`             | Game design spec: rules, squad, packs, leagues, economy, edge cases, regulatory guardrails, MVP scope |
| `docs/DESIGN.md`           | Visual direction, screen list, which mockup file shows which screen, interaction notes                |
| `design/tokens.json`       | Colours, fonts, radii, icon style, motion timings (Clean Fantasy theme)                               |
| `design/mockups/*.dc.html` | Reference mockups for every screen (layout and copy reference; see `design/mockups/README.md`)        |
| `config/scoring.v0.2.json` | Scoring actions, points by position, tiers, captain/bold/chaos rules, rarity multipliers              |
| `config/economy.v0.1.json` | Coins prices, free packs, season milestones, compensation rules                                       |
| `tools/sim/`               | Python simulator used to tune the points table on 2025/26 data                                        |

If anything here conflicts, the order of authority is: this file, then `config/*.json`, then `docs/SPEC.md`, then the mockups.

## Non-negotiable rules for the test build

1. **No real money.** No purchases, no cash-out, no trading cards for money, no prizes. Coins and Season Points are worth nothing outside the game.
2. **Unlicensed presentation.** Real player names, shirt numbers, positions and three-letter club codes in fixture context ("v ARS (H)") only. **No** player photos, club crests, kit designs, club colour schemes, Premier League name, logo or marks. Shirts are the generic kit-style shirt in rarity colours (see `design/mockups/Shirt.dc.html`).
3. **Disclaimer** on sign-up and in Settings: "Not affiliated with or endorsed by the Premier League, any club or any player."
4. **Closed test.** Distribute only via TestFlight / Play internal testing. Invite-only, capped cohort (200–500), no public store listing.
5. **Data source.** Use a contracted commercial data feed in production. During development, use the public 2025/26 FPL dataset (`vaastav/Fantasy-Premier-League` on GitHub) for fixtures and replay tests. **Do not** call or scrape the fantasy.premierleague.com API from the app or backend.
6. **Every action is about one player.** Never add match-result, both-teams-to-score or odds-like markets. Points never vary by fixture.
7. **Server is authoritative** for deadlines, locks, pack openings, scoring and Coins. Never trust the client clock.
8. **UK GDPR.** Privacy notice covering account data and the use of publicly reported match statistics (legitimate interests). Phone numbers stored hashed where possible.

## Recommended stack (change if the team prefers, but keep the architecture rules)

- **Monorepo** (pnpm + Turborepo): `apps/mobile`, `apps/api`, `apps/admin`, `packages/scoring`, `packages/shared`.
- **Mobile:** Expo (React Native) + TypeScript, Expo Router, Expo Notifications, Reanimated for the pack animation.
- **API:** Node + TypeScript (Fastify), Postgres (Prisma or Drizzle), Redis + BullMQ for scheduled jobs (deadline lock, live polling, 09:00 finalisation, weekly free packs).
- **Auth:** phone number + one-time code (e.g. Twilio Verify). No passwords.
- **Admin:** small React web app (or AdminJS) behind staff auth.
- **Hosting:** Railway (Postgres, Redis, API, worker) is fine for the test.
- **Share images:** server-side render (e.g. Satori/resvg) for the 9:16 and square recap cards.

## Architecture rules

- **Scoring is a pure, versioned package** (`packages/scoring`). Input: player match stats + picked actions + rules config. Output: points with a line-by-line breakdown ("Assist landed: 15 × 1.0 rarity × 2 bold = 30"). No I/O, fully deterministic, so any gameweek can be **re-scored from raw data** when stats are revised.
- **Points table and economy are data, not code.** Load from `config/*.json` into the database with a `version` and `season`; the app reads the active version. Changing prices or points must not need a release.
- **Data provider adapter.** One interface (`fixtures`, `squads`, `liveMatchStats`, `finalMatchStats`, `transfers`) with two implementations: `FplDatasetProvider` (dev/replay) and `CommercialProvider` (stub until the contract is signed).
- **Coins ledger.** Every earn and spend is an immutable ledger row; balance is derived. No editable balance column.
- **Pack openings server-side.** RNG on the server; every opening logged with pack type, odds version, seed and result.
- **Idempotent jobs.** Locking, scoring, finalisation and reward grants can be re-run safely.
- **Analytics events** from day one (see "Test metrics" below).

## Build phases and acceptance criteria

Work through these in order. Each phase ends with passing tests and a short note in `docs/PROGRESS.md`.

### Phase 0 — Repo and tooling

- Monorepo scaffold, TypeScript strict, ESLint/Prettier, CI running tests on every push.
- Seed script that loads `config/scoring.v0.2.json` and `config/economy.v0.1.json`.
- **Done when:** CI is green and `pnpm dev` runs the API and the Expo app.

### Phase 1 — Scoring engine + season replay

- Implement `packages/scoring` from `config/scoring.v0.2.json`: overlap groups, max 2 actions per starter, captain ×2, one bold action (×2 if landed, −50% of base if missed), max one chaos action per squad, rarity multipliers, sub rule, double gameweeks, clean sheet 60+ minutes.
- Port `tools/sim/sim.py` logic into a TypeScript replay test over all 38 gameweeks of 2025/26.
- **Re-run the simulation including captain and bold action** and write `docs/ECONOMY_CHECK.md`: average points per gameweek for casual and smart strategies, and whether 100 / 60 / 400 Coin prices give roughly one new card per week including the weekly free pack. Propose adjusted prices if not.
- **Done when:** unit tests cover every rule above; replay of 2025/26 produces identical totals on repeat runs; economy check written.

### Phase 2 — Data ingestion

- Provider interface + `FplDatasetProvider` (fixtures, players, positions, clubs, gameweek stats).
- Jobs: create gameweeks and deadlines; lock at deadline; finalise at 09:00 Europe/London the morning after the last match; apply stat revisions until finalisation, never after.
- Handle postponed/abandoned matches (void actions, return chips) and blank/double gameweeks.
- **Done when:** a simulated gameweek can be ingested, locked, scored live from replayed stats, revised and finalised end to end in tests.

### Phase 3 — Accounts, cards and squads

- Phone sign-up, display name, favourite club (content only), age confirmation (16+), disclaimer acceptance.
- Card model: player, rarity (bronze/silver/gold/elite), rating, level, club at opening, active/inactive.
- Starter pack (balanced: same tier, one guaranteed stronger card), player pack, swap pack, squad pack. Server-side opening with logged odds.
- Squad: 1 GK, 1 DEF, 2 MID, 1 FWD + 1 sub of any position; max 2 players per club; squad rating cap.
- Transfers between PL clubs (card follows player), leaving the PL / relegation / retirement (card inactive, free same-rarity swap pack), return to PL (reactivate). Effective from the next deadline after registration.
- **Done when:** a new user can sign up, open a starter pack and have a valid squad; transfer and relegation scenarios are covered by tests.

### Phase 4 — Picking actions (the core weekly flow)

- Pitch view and scoring actions sheet as in the mockups (`Predictions.dc.html`, `ActionSheet.dc.html`).
- Tiers shown as Likely / Possible / Bold / Long shot / Chaos with "+N pts" and a form hint ("3+ tackles in 3 of last 5").
- Same as last week, Auto-pick (fills empty slots with the highest-average likely/possible action), captain, bold action.
- Missed deadline → last week's actions carried over automatically (no penalty).
- **Done when:** a returning user can set all actions in under 60 seconds in a usability run; server rejects edits after lock.

### Phase 5 — Live matchday and notifications

- Home switches to live mode at first kick-off: pitch with points bubbles, action states (pending / landed / missed), live mini-league movement (`Live.dc.html`).
- Push: deadline reminders (24h and 2h, only if not confirmed), actions carried over, action landed (batched within a minute), recap ready, card changed club, new pack (max one a day). All individually switchable.
- **Done when:** replaying a gameweek in staging produces the right live updates and notifications.

### Phase 6 — Leagues

- Global table; private mini-leagues with invite links (deep link into the league after onboarding); Season and This week views; ties by most actions landed, then fewest actions picked (`Leagues.dc.html`, `History.dc.html`).
- **Done when:** a user can create a league, invite by link, and see correct tables after a replayed gameweek.

### Phase 7 — Coins, packs and rewards

- Coins ledger (1 Coin per point), prices from config, weekly free pack (unlocked by confirming actions), season milestones, swap a card, "progress to next pack" on Home and the Coins & packs screen (`Rewards.dc.html`).
- Pack opening animation per `design/tokens.json` motion spec (`PackMotion.dc.html`), with Skip and Reduce Motion.
- **Done when:** ledger reconciles to balance in tests; milestones grant exactly once; pack odds are logged and shown.

### Phase 8 — Recap and sharing

- Recap screen and server-rendered 9:16 / square share card with invite code, no crests or photos (`Recap.dc.html`, `ShareCard.dc.html`).
- **Done when:** a finalised gameweek produces a recap and a shareable image per user.

### Phase 9 — Admin console

- Void a match, process transfers and relegation, edit card ratings, switch points/economy config versions, view pack-open logs, look up a user's ledger and scoring breakdown.
- **Done when:** staff can handle every edge case in `docs/SPEC.md` without a developer.

## Out of scope for the MVP

Paid purchases of any kind, season pass, subscription, chips, head-to-head, Top Trumps duels, club sets, special editions, annual re-rating, advanced-feed actions, dark mode, licensed branding. Design the data model so licensed fields (photo, crest, club colours) can be added later without a redesign.

## Test metrics (instrument these)

| Metric                          | Target                                             |
| ------------------------------- | -------------------------------------------------- |
| Install to first actions locked | under 2 minutes (median)                           |
| Time to pick weekly actions     | under 60 seconds (median, returning players)       |
| Gameweek retention              | 60%+ of week-1 players active at GW8               |
| Mini-league membership          | 70%+ of active players in at least one             |
| Recap shares                    | 15%+ of active players share at least once a month |
| Invites per active player       | 0.5+ over the test window                          |

## Open decisions (ask before building around these)

- Final game name and brand.
- Commercial data provider (basic vs advanced feed) — MVP assumes basic feed actions only.
- Whether chaos actions (yellow card, scores and booked) stay in for launch.
- Final Coins prices after the Phase 1 economy check.
