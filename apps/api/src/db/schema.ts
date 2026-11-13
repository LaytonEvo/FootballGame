import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => text('id').primaryKey();
const createdAt = () =>
  ts('created_at')
    .notNull()
    .default(sql`now()`);

/** Scoring and economy tables are data: versioned rows, one active per kind+season. */
export const configVersions = pgTable(
  'config_versions',
  {
    id: id(),
    kind: text('kind', { enum: ['scoring', 'economy', 'packs'] }).notNull(),
    version: text('version').notNull(),
    season: text('season').notNull(),
    body: jsonb('body').notNull(),
    active: boolean('active').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('config_versions_kind_version_season').on(t.kind, t.version, t.season)],
);

export const clubs = pgTable('clubs', {
  id: id(),
  providerRef: text('provider_ref').notNull().unique(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  inLeague: boolean('in_league').notNull().default(true),
  // Licensed fields, unused in the unlicensed test build (never populated): crest, colours.
  crestUrl: text('crest_url'),
  primaryColour: text('primary_colour'),
});

export const players = pgTable(
  'players',
  {
    id: id(),
    providerRef: text('provider_ref').notNull().unique(),
    name: text('name').notNull(),
    position: text('position', { enum: ['GK', 'DEF', 'MID', 'FWD'] }).notNull(),
    shirtNumber: integer('shirt_number'),
    clubId: text('club_id').references(() => clubs.id),
    status: text('status', { enum: ['active', 'left_league', 'retired'] })
      .notNull()
      .default('active'),
    /** Card rating 40-99. Drives rarity bands and the squad rating cap. Editable by staff. */
    rating: integer('rating').notNull(),
    /** Fitness flag from the feed (injured / doubtful / suspended) and its news line. */
    availability: text('availability'),
    news: text('news'),
    photoUrl: text('photo_url'), // licensed field, unused
  },
  (t) => [index('players_club').on(t.clubId)],
);

export const gameweeks = pgTable(
  'gameweeks',
  {
    id: id(),
    season: text('season').notNull(),
    number: integer('number').notNull(),
    deadlineAt: ts('deadline_at').notNull(),
    firstKickoffAt: ts('first_kickoff_at').notNull(),
    lastKickoffAt: ts('last_kickoff_at').notNull(),
    finaliseAt: ts('finalise_at').notNull(),
    status: text('status', { enum: ['upcoming', 'locked', 'live', 'provisional', 'finalised'] })
      .notNull()
      .default('upcoming'),
    lockedAt: ts('locked_at'),
    finalisedAt: ts('finalised_at'),
    scoringVersion: text('scoring_version'),
  },
  (t) => [uniqueIndex('gameweeks_season_number').on(t.season, t.number)],
);

export const fixtures = pgTable(
  'fixtures',
  {
    id: id(),
    providerRef: text('provider_ref').notNull().unique(),
    gameweekId: text('gameweek_id').references(() => gameweeks.id),
    homeClubId: text('home_club_id')
      .notNull()
      .references(() => clubs.id),
    awayClubId: text('away_club_id')
      .notNull()
      .references(() => clubs.id),
    kickoffAt: ts('kickoff_at'),
    status: text('status', { enum: ['scheduled', 'live', 'finished', 'postponed', 'abandoned'] })
      .notNull()
      .default('scheduled'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    /** Staff override: void every action on this match. */
    voided: boolean('voided').notNull().default(false),
  },
  (t) => [index('fixtures_gw').on(t.gameweekId)],
);

/** Latest stats per player per fixture. Revisions are appended to stat_revisions. */
export const playerMatchStats = pgTable(
  'player_match_stats',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixtures.id),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id),
    stats: jsonb('stats').notNull(),
    revision: integer('revision').notNull().default(1),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.fixtureId] }), index('pms_fixture').on(t.fixtureId)],
);

export const statRevisions = pgTable('stat_revisions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: text('player_id').notNull(),
  fixtureId: text('fixture_id').notNull(),
  revision: integer('revision').notNull(),
  stats: jsonb('stats').notNull(),
  receivedAt: ts('received_at').notNull(),
  applied: boolean('applied').notNull(),
});

export const users = pgTable('users', {
  id: id(),
  phoneHash: text('phone_hash').notNull().unique(),
  displayName: text('display_name'),
  favouriteClubId: text('favourite_club_id').references(() => clubs.id),
  ageConfirmedAt: ts('age_confirmed_at'),
  disclaimerAcceptedAt: ts('disclaimer_accepted_at'),
  inviteCode: text('invite_code').notNull().unique(),
  notificationPrefs: jsonb('notification_prefs').notNull().default({}),
  pushToken: text('push_token'),
  createdAt: createdAt(),
});

export const otpChallenges = pgTable('otp_challenges', {
  id: id(),
  phoneHash: text('phone_hash').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: ts('consumed_at'),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});

export const packs = pgTable(
  'packs',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', {
      enum: ['starter', 'player', 'swap', 'squad', 'silver', 'gold', 'elite', 'totw'],
    }).notNull(),
    source: text('source', {
      enum: [
        'signup',
        'coins',
        'weekly_free',
        'milestone',
        'swap',
        'compensation',
        'admin',
        'team_of_the_week',
      ],
    }).notNull(),
    /** Swap and compensation packs are fixed to a rarity. */
    rarity: text('rarity', { enum: ['bronze', 'silver', 'gold', 'elite'] }),
    /** Team of the Week packs draw from that gameweek's editions. */
    gameweekId: text('gameweek_id'),
    status: text('status', { enum: ['sealed', 'opened'] })
      .notNull()
      .default('sealed'),
    /** Unique key that makes reward grants idempotent (e.g. "weekly:<user>:<gw>"). */
    grantKey: text('grant_key').notNull().unique(),
    grantedAt: ts('granted_at').notNull(),
    openedAt: ts('opened_at'),
    oddsVersion: text('odds_version'),
    seed: text('seed'),
    result: jsonb('result'),
  },
  (t) => [index('packs_user').on(t.userId)],
);

export const cards = pgTable(
  'cards',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    rarity: text('rarity', { enum: ['bronze', 'silver', 'gold', 'elite'] }).notNull(),
    rating: integer('rating').notNull(),
    level: integer('level').notNull().default(1),
    clubAtOpeningId: text('club_at_opening_id').references(() => clubs.id),
    active: boolean('active').notNull().default(true),
    inactiveReason: text('inactive_reason'),
    packId: text('pack_id').references(() => packs.id),
    swappedAt: ts('swapped_at'),
    /** Limited edition this card belongs to, and its number within the edition (e.g. #12 of 50). */
    editionId: text('edition_id'),
    serial: integer('serial'),
    createdAt: createdAt(),
  },
  (t) => [index('cards_user').on(t.userId), index('cards_player').on(t.playerId)],
);

/** Slots 0-4 = GK, DEF, MID, MID, FWD; 5 = substitute. */
export const squadSlots = pgTable(
  'squad_slots',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    slot: integer('slot').notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slot] }), uniqueIndex('squad_card').on(t.cardId)],
);

/** One selection per user per gameweek; locked copy is what gets scored. */
export const selections = pgTable(
  'selections',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    gameweekId: text('gameweek_id')
      .notNull()
      .references(() => gameweeks.id),
    body: jsonb('body').notNull(),
    confirmedAt: ts('confirmed_at'),
    carriedOver: boolean('carried_over').notNull().default(false),
    lockedAt: ts('locked_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameweekId] })],
);

export const gameweekScores = pgTable(
  'gameweek_scores',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    gameweekId: text('gameweek_id')
      .notNull()
      .references(() => gameweeks.id),
    rulesVersion: text('rules_version').notNull(),
    total: integer('total').notNull(),
    actionsLanded: integer('actions_landed').notNull(),
    actionsPicked: integer('actions_picked').notNull(),
    provisional: boolean('provisional').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    computedAt: ts('computed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameweekId] }), index('scores_gw').on(t.gameweekId)],
);

/** Immutable Coins ledger. Balance = sum(amount). No balance column anywhere. */
export const coinLedger = pgTable(
  'coin_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(),
    reason: text('reason', {
      enum: ['gameweek_points', 'pack_purchase', 'card_swap', 'admin_adjustment'],
    }).notNull(),
    ref: text('ref'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('ledger_user').on(t.userId)],
);

export const leagues = pgTable('leagues', {
  id: id(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const leagueMembers = pgTable(
  'league_members',
  {
    leagueId: text('league_id')
      .notNull()
      .references(() => leagues.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    joinedAt: ts('joined_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);

export const playerMoves = pgTable('player_moves', {
  id: id(),
  /** Provider reference (or "admin:<uuid>") — makes ingestion idempotent. */
  ref: text('ref').notNull().unique(),
  playerId: text('player_id')
    .notNull()
    .references(() => players.id),
  kind: text('kind', { enum: ['transfer', 'left_league', 'retired', 'returned'] }).notNull(),
  toClubId: text('to_club_id').references(() => clubs.id),
  registeredAt: ts('registered_at').notNull(),
  /** Takes effect from the first deadline after registration. */
  effectiveGameweekId: text('effective_gameweek_id').references(() => gameweeks.id),
  processedAt: ts('processed_at'),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').notNull().default({}),
    dedupeKey: text('dedupe_key').notNull().unique(),
    createdAt: ts('created_at').notNull(),
    sendAfter: ts('send_after').notNull(),
    sentAt: ts('sent_at'),
    suppressed: text('suppressed'),
  },
  (t) => [index('notifications_user').on(t.userId)],
);

export const analyticsEvents = pgTable('analytics_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  props: jsonb('props').notNull().default({}),
  at: ts('at').notNull(),
});

export const adminAudit = pgTable('admin_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  staff: text('staff').notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload').notNull(),
  at: ts('at').notNull(),
});

/**
 * Limited editions: a fixed number of numbered cards, earned only (never sold). Team of the Week = the best
 * performers of a finalised gameweek; supply is capped per player.
 */
export const editions = pgTable(
  'editions',
  {
    id: id(),
    kind: text('kind', { enum: ['team_of_the_week'] }).notNull(),
    name: text('name').notNull(),
    gameweekId: text('gameweek_id')
      .notNull()
      .references(() => gameweeks.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    supply: integer('supply').notNull(),
    issued: integer('issued').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('editions_kind_gw_player').on(t.kind, t.gameweekId, t.playerId)],
);

/** Card-for-card trade offers between players. No Coins or money ever change hands. */
export const trades = pgTable(
  'trades',
  {
    id: id(),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => users.id),
    offeredCardId: text('offered_card_id')
      .notNull()
      .references(() => cards.id),
    requestedCardId: text('requested_card_id')
      .notNull()
      .references(() => cards.id),
    status: text('status', { enum: ['open', 'accepted', 'declined', 'cancelled', 'expired'] })
      .notNull()
      .default('open'),
    reason: text('reason'),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    respondedAt: ts('responded_at'),
  },
  (t) => [index('trades_from').on(t.fromUserId), index('trades_to').on(t.toUserId)],
);
