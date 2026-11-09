# Fantasy Five (working title)

Closed-test MVP of a 5-a-side Premier League fantasy card game. Build brief: `CLAUDE.md`. Status per phase:
`docs/PROGRESS.md`. Design: `docs/SPEC.md`, `docs/DESIGN.md`, `design/`. Economy check: `docs/ECONOMY_CHECK.md`.
Staff runbook: `docs/ADMIN.md`.

## Layout

| Path                   | What                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api`             | Fastify API + worker (Drizzle/Postgres, BullMQ). Jobs: lock, live scoring, finalisation, rewards, notifications |
| `apps/mobile`          | Expo (React Native) app, Expo Router                                                                            |
| `apps/admin`           | Staff console (Vite + React)                                                                                    |
| `packages/scoring`     | Pure, versioned scoring engine + 2025/26 replay                                                                 |
| `packages/shared`      | Domain types and config schemas                                                                                 |
| `packages/fpl-dataset` | Loader for the committed 2025/26 public dataset snapshot (dev/replay only)                                      |
| `config/`              | Scoring, economy and pack configs (data, loaded into the database by version)                                   |

## Run it

```bash
pnpm install
pnpm seed                            # load configs (embedded Postgres in apps/api/.data unless DATABASE_URL is set)
pnpm --filter @ff/api dev:sync       # load clubs/players/fixtures and replay the season up to today
pnpm dev                             # API on :3000 + Expo on :8081
pnpm --filter @ff/admin dev          # staff console on :5174 (needs STAFF_TOKENS on the API)
pnpm --filter @ff/api worker         # scheduled jobs (BullMQ with REDIS_URL, else in-process)
```

Dev sign-in codes are printed in the API log (no SMS without Twilio credentials).

## Checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm economy-check                   # re-run the 2025/26 replay and rewrite docs/ECONOMY_CHECK.md
pnpm --filter @ff/api replay:gameweek --gw 12   # drive one gameweek through every job on a fake clock
```

Not affiliated with or endorsed by the Premier League, any club or any player. No real money.
