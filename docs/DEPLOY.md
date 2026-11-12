# Deployment (Railway)

Project **fantasy-five** (workspace "laytonevo's Projects"), environment `production`, region europe-west4.
Every service deploys from GitHub `LaytonEvo/FootballGame`, branch `claude/new-session-awkju6`, on push.

| Service         | Source                                                                                                    | URL                                          |
| --------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| api             | `deploy/api.Dockerfile`, health check `/health`                                                           | https://api-production-ee6f.up.railway.app   |
| worker          | same image, start `pnpm --filter @ff/api worker` (BullMQ: tick every minute, reference sync 04:00 London) | —                                            |
| admin           | `deploy/admin.Dockerfile` (`VITE_API_URL` baked in at build)                                              | https://admin-production-fda6.up.railway.app |
| web             | `deploy/web.Dockerfile`, browser preview of the mobile app (`EXPO_PUBLIC_API_URL` at build)               | https://web-production-238e8.up.railway.app  |
| Postgres, Redis | Railway templates                                                                                         | private network only                         |

Variables live on each service in Railway (never in the repo): `DATABASE_URL` and `REDIS_URL` are references
to the Postgres and Redis services; `PHONE_HASH_SECRET` and `STAFF_TOKENS` were generated at setup (worker
references the api's `PHONE_HASH_SECRET` — never change it once players have signed up, or phone matching
breaks). Staff console token: api service → Variables → `STAFF_TOKENS` (format `name:token`).

The worker syncs clubs, players and fixtures on every boot and replays any gameweeks whose deadlines have
passed (the 2025/26 dataset is shifted +364 days, so it plays out live across 2026/27).

## Still to configure

- **SMS is bypassed for testing:** `OTP_BYPASS_CODE` is set on the api, so sign-up asks for no phone number at all
  ("Start playing"); the account lives on that device. Anyone who types a tester's number gets their account, so **delete
  `OTP_BYPASS_CODE` before real testers join** and set up Twilio instead.
- **SMS (later):** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` on the api. Without either, sign-in codes appear only in the api deploy logs.
- **Push:** works from EAS builds of the mobile app (`EXPO_ACCESS_TOKEN` optional). The web preview has no push.
- **Mobile builds:** build with `EXPO_PUBLIC_API_URL=https://api-production-ee6f.up.railway.app` (EAS).
- **Custom domains:** after adding one, update `PUBLIC_WEB_URL` (invite links), `VITE_API_URL` and
  `EXPO_PUBLIC_API_URL`, and redeploy admin and web.
