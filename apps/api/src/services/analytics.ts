import type { DbOrTx } from '../db/client.js';
import { analyticsEvents } from '../db/schema.js';

/**
 * Analytics event names. Test metrics derive from these:
 * install→first lock (app_opened → actions_confirmed), pick time (pick_started → actions_confirmed),
 * retention (gameweek_active), league membership (league_joined), shares (recap_shared), invites (invite_*).
 */
export type EventName =
  | 'app_opened'
  | 'signup_started'
  | 'signup_verified'
  | 'profile_completed'
  | 'pack_opened'
  | 'squad_updated'
  | 'pick_started'
  | 'actions_confirmed'
  | 'actions_carried_over'
  | 'gameweek_active'
  | 'league_created'
  | 'league_joined'
  | 'invite_link_opened'
  | 'invite_accepted'
  | 'recap_viewed'
  | 'recap_shared'
  | 'coins_spent'
  | 'notification_sent';

export async function track(
  db: DbOrTx,
  at: Date,
  userId: string | null,
  name: EventName,
  props: Record<string, unknown> = {},
) {
  await db.insert(analyticsEvents).values({ userId, name, props, at });
}
