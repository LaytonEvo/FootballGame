# 5-a-side Fantasy Card Game — Game Design Spec

Source of truth for design intent. Live version: https://claude.ai/artifact/33we3TPZfxyaNQJXrYhVyY (owner access). Scoring and economy numbers live in `config/` and override any number here.

## Overview

A season-long 5-a-side Premier League fantasy game where you score by picking the scoring actions you think each of your players will make in their real match. Squads come from packs; points accumulate across the season and Coins fund upgrades.

**What makes it different:** FPL scores whatever a player does. This game scores whether you called it, so the skill is reading the fixture, not just picking stars.

**Design principles**

- Points are priced by difficulty: the rarer the action for that position, the more it pays.
- No single pick is always right. Long shots pay big but are worse on average.
- Free players can compete. Spending widens the collection, not the leaderboard.
- Every action is about one player, never a match result or a both-teams-to-score market.
- Closed economy: nothing in the game converts to money or money's worth.

**Audience (working assumption):** adults and older teens (16+), UK first.

## Core loop (weekly)

1. **Manage squad** — open packs, set lineup, swap cards.
2. **Lock actions** — 1–2 per player, captain, bold action. Locks 90 minutes before the first kick-off.
3. **Matchday** — live scoring and "action landed" alerts.
4. **Finalise** — scores fixed at 09:00 the next morning.
5. Outputs: **Season Points** (league tables, never spent) and **Coins** (packs, swaps), spent before the next deadline.

The loop repeats 38 times a season.

## Squad, packs and cards

- **Squad:** five starters in a fixed shape (1 GK, 1 DEF, 2 MID, 1 FWD) plus one substitute of any position. Maximum two players from one club.
- **Starter pack:** every new account opens one basic pack of five players in the squad shape. All five from the same tier, with one guaranteed stronger card.
- **Pack types**

| Pack        | Contents                                      | How you get it                                                 |
| ----------- | --------------------------------------------- | -------------------------------------------------------------- |
| Starter     | 5 players, squad shape, balanced              | Once, on sign-up                                               |
| Player pack | 1 player, any position                        | Coins, weekly free pack, milestones                            |
| Swap pack   | 1 player, same rarity as the card it replaces | Swapping a card, or automatically on transfer out / relegation |
| Squad pack  | 5 players, squad shape                        | Coins, milestones                                              |

- **Rarity:** Bronze, Silver, Gold, Elite. (Special editions — Player of the Month, New Signing — are post-MVP.)
- **Rarity multiplier on points:** Bronze ×1.2, Silver ×1.1, Gold ×1.0, Elite ×0.9. Stops strong cards running away with leagues (simulation: Elite-vs-Bronze gap falls from 1.47× to about 1.10×).
- **Squad rating cap:** active five plus sub must sit under a cap, so more Elite cards widen choice but do not stack a squad.
- **Duplicates:** level a card up (cosmetic frame; extra action slot at higher levels — post-MVP).
- **Collection, club sets, annual re-rating:** post-MVP. Cards, levels and collection carry over between seasons; Season Points reset each August.

## Scoring actions

Full table, tiers and hit rates: `config/scoring.v0.2.json`.

**Pricing rules**

- Same action, different value by position (a defender's goal pays far more than a striker's).
- Likely, Possible and Bold actions return similar average points per pick; long shots and chaos actions sit deliberately below.
- Counting stats use thresholds ("3+ tackles"), so every action resolves yes or no.
- Points are fixed for the season and never vary by fixture. Reading the fixture is the skill.
- The app shows each action's tier (Likely, Possible, Bold, Long shot, Chaos) for that player's position.

**Selection rules (per gameweek)**

- One or two actions per starter; the two may not share an overlap group (no "goal" plus "goal involvement").
- The substitute carries their own pre-set actions and comes in only if a starter plays 0 minutes.
- Captain: one starter's action points are doubled.
- Bold action: once per gameweek; double if it lands, minus half its base value if it misses.
- Maximum one chaos action (yellow card, scores and booked) per squad.
- Actions lock at the deadline. Nothing changes after lock. Missed deadline → last week's actions carried over.

**Removed:** red card, own goal, missed penalty (under 1% of matches and the main spot-fixing markets).

**Chips (post-MVP):** Double Action, Shield, Triple Captain, Free Rebuild — one set per half-season.

## Leagues and competition

Season Points decide every table; Coins never do.

| League                  | Who                                | Window                                     |
| ----------------------- | ---------------------------------- | ------------------------------------------ |
| Global                  | Everyone                           | Season, plus monthly and weekly sub-tables |
| Private mini-leagues    | Invite link / code                 | Season and This week                       |
| Head-to-head (post-MVP) | Paired weekly within a mini-league | Weekly W/D/L                               |

Ties: most actions landed, then fewest actions picked. Weekly and monthly tables stop a slow start ending someone's season.

## Economy

Numbers: `config/economy.v0.1.json`.

| Currency      | Earned by                      | Spent on                              | Affects ranking |
| ------------- | ------------------------------ | ------------------------------------- | --------------- |
| Season Points | Actions that land              | Never spent                           | Yes             |
| Coins         | 1 per point scored, milestones | Player packs, squad packs, card swaps | No              |

- **Working prices:** player pack 100 Coins, card swap 60, squad pack 400.
- **Weekly free pack:** one player pack each gameweek, unlocked by confirming that week's actions.
- **Season milestones:** 250 → Silver pack, 500 → Gold pack, 750 → Gold pack, 1,000 → Elite pack.
- **Progress to next pack** always visible (Home Coins chip with mini bar; Coins & packs screen).
- **Revenue (post-test, cleanest first):** season pass; premium subscription; visible card purchases; paid random packs (PEGI 16+, highest regulatory exposure).
- **Never:** cash-out, real-money trading of cards, real-money prizes on paid entry.

## Transfers, relegation and season rollover

The card belongs to the player, not the club.

| Event                            | Card                                                       | Owner compensation                   |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| Moves to another PL club         | Follows the player and keeps scoring                       | None                                 |
| Leaves the PL (abroad, loan out) | Inactive: stays in collection, can't be in the active five | Free swap pack, same rarity          |
| Returns to the PL                | Reactivates; owner keeps the swap-pack card too            | None                                 |
| Retires                          | Inactive                                                   | Free swap pack, same rarity          |
| Club relegated                   | Its players' cards go inactive at season end               | Free swap pack per card, same rarity |
| Club promoted                    | Its players enter the pack pool                            | n/a                                  |

Transfers take effect from the next deadline after official registration, never mid-gameweek. Actions already locked on an outgoing player still score that gameweek. Transfer-window changes are notified once, grouped.

## Match-day rules and edge cases

| Situation                           | Rule                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Starter plays 0 minutes             | Substitute comes in with their own pre-set actions                                |
| Starter and sub both play 0 minutes | Slot scores 0; no penalty; bold action on it voided                               |
| Blank gameweek for a player's club  | Treated as 0 minutes (sub rule applies)                                           |
| Double gameweek                     | Actions resolve on combined stats across both matches                             |
| Match postponed or abandoned        | Actions on affected players voided; chips used that week returned                 |
| Stats revised after the match       | Applied until finalisation at 09:00 the morning after the last match; never after |
| Clean sheet                         | Requires 60+ minutes on the pitch; any goal conceded while on the pitch breaks it |
| Player sent off                     | Actions resolve on what happened before the red card                              |
| Leaderboard tie                     | Most actions landed, then fewest actions picked                                   |

**Account integrity:** phone verification; no card gifting between accounts under 30 days old.

## User experience

Two numbers decide the game: picking weekly actions in under 60 seconds, and a matchday that makes people open the app during games.

**Principles:** mobile-first and one-handed; one primary action per screen; teach by doing (features introduced as tooltips the week they become useful); every point traces to the stat that earned it; missing a week never ends your season.

**Key flows**

1. **Onboarding (first actions within 2 minutes):** phone + code → display name and favourite club → open starter pack → squad auto-placed → guided first player, rest via Auto-pick → captain, confirm, see countdown and mini-league invite card.
2. **Weekly actions (under 60 seconds):** Home shows the countdown and one button, Pick your actions → pitch view of the five (FWD top, two MIDs, DEF, GK; sub on a bench strip), each shirt with name plate and two action slots → tap a slot for the scoring actions sheet grouped by tier with "+N pts" and form hints → Same as last week / Auto-pick → tap to set captain, long-press to mark bold → Confirm (editable until deadline).
3. **Pack opening:** sealed pack never auto-opens; tap → shake, tear, rarity glow, card flip (about 2 s) → Put in my five / Keep in collection / Swap. Skip always visible; Reduce Motion = fade. No near-miss effects.
4. **Matchday:** Home switches to live; pitch view with points bubbles and pending / landed / missed actions; push when an action lands; live mini-league movement; provisional banner until 09:00.
5. **Recap and share:** push when ready; points, actions landed, the five with points, best action, league moves, Coins earned, pack unlocked; one-tap 9:16 / square share card with invite code (no crests or photos), WhatsApp first.
6. **Mini-league invite:** create → link → opens app (or store → onboarding) → lands in the league after the starter pack.

**Notifications** (each switchable): deadline reminder 24h and 2h (only if not confirmed); actions carried over; action landed (batched per minute); mini-league overtaken (off by default); recap ready; card changed club / inactive (grouped); new pack (max one a day). No marketing pushes during the test.

**Accessibility:** hit/miss by icon and colour; text up to 200% without clipping; screen-reader labels; Reduce Motion respected; 44×44 pt touch targets.

**Responsible design:** no countdowns or scarcity on anything purchasable; no penalty for missing a week; pack odds visible on the pack; spending totals and limits once purchases exist.

## Data requirements

MVP uses **basic feed** actions only: goals, assists, goal involvement, clean sheets, saves, penalty saves, minutes, yellow cards. Advanced-feed actions (tackles, CBI, defensive contribution, shots, chances, dribbles) are in the config but gated by `data_feed: "advanced"`.

| Need                                                       | Basic                  | Advanced               |
| ---------------------------------------------------------- | ---------------------- | ---------------------- |
| Goals, assists, minutes, starts, subs                      | Yes                    | Yes                    |
| Clean sheets, goals conceded, saves                        | Yes                    | Yes                    |
| Cards, penalties saved                                     | Yes                    | Yes                    |
| Tackles, interceptions, clearances, defensive contribution | No                     | Yes                    |
| Shots on target, chances created, dribbles                 | No                     | Yes                    |
| Live latency                                               | Minutes                | Seconds                |
| Fixtures, squads, transfers                                | Licensed fixtures data | Licensed fixtures data |

## Regulatory and integrity guardrails

- No cash-out, no real-money trading, no blockchain.
- No real-money prizes on paid entry without written legal sign-off.
- Actions always about one player; points never vary by fixture odds.
- Chaos actions capped at one per squad and priced below average return; drop them if pursuing a league licence.
- If paid random packs are ever added: published odds, spending limits, 16+ age gate (PEGI 16 default for paid random items).
- Unlicensed test: names, numbers, positions and club codes only; no photos, crests, kits or league marks; disclaimer shown.
- Context: the UK Gambling Commission is prosecuting Sorare (paid packs + resellable cards + prizes); trial listed for June 2027.

## MVP scope

**In:** phone sign-up and starter pack; squad of five plus sub with rating cap; basic-feed actions; captain and bold action; deadline lock, live scoring, notifications, 09:00 finalisation; Season Points and Coins; weekly free pack, milestones, player pack purchase with Coins, card swap; transfer and relegation handling; global table and mini-leagues; recap and share card; admin console.

**Out:** paid purchases, season pass, subscription, chips, head-to-head, duels, club sets, special editions, re-rating, advanced-feed actions, dark mode, licensed branding.

**Success test:** gameweek-on-gameweek retention and invites per user over the first eight gameweeks.

## Simulation summary (2025/26 data)

- Data: all 38 gameweeks of public FPL player-gameweek stats; pick pool = players averaging 60+ minutes over their previous four gameweeks.
- v0.1 made the striker's goal the dominant pick; v0.2 brings regular actions into a 1.4–1.8 points-per-pick band.
- Skill pays: a smart strategy beats "always pick the goal" by 17% under v0.2 (strategies did not read fixtures, so real edge should be larger).
- Chaos chasing finishes last, so chaos picks cannot win a league.
- Not yet simulated: captain, bold action, chips, advanced-feed actions. Phase 1 re-runs it with captain and bold to confirm Coins prices.

## Open decisions

- [ ] Final name and brand.
- [ ] Data provider and feed level.
- [ ] Keep chaos actions at launch?
- [ ] Coins prices (100 / 60 / 400) and milestone levels after the Phase 1 economy check.
- [ ] Audience and revenue model after the test (adults with paid packs vs families with earned packs only).
- [ ] Licensing route after the test (FIFPRO player rights, league licence, or partner).
