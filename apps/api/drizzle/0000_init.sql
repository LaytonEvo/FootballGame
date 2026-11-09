CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"staff" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"player_id" text NOT NULL,
	"rarity" text NOT NULL,
	"rating" integer NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"club_at_opening_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"inactive_reason" text,
	"pack_id" text,
	"swapped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_ref" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"in_league" boolean DEFAULT true NOT NULL,
	"crest_url" text,
	"primary_colour" text,
	CONSTRAINT "clubs_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "coin_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "coin_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"season" text NOT NULL,
	"body" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_ref" text NOT NULL,
	"gameweek_id" text,
	"home_club_id" text NOT NULL,
	"away_club_id" text NOT NULL,
	"kickoff_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"voided" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fixtures_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "gameweek_scores" (
	"user_id" text NOT NULL,
	"gameweek_id" text NOT NULL,
	"rules_version" text NOT NULL,
	"total" integer NOT NULL,
	"actions_landed" integer NOT NULL,
	"actions_picked" integer NOT NULL,
	"provisional" boolean NOT NULL,
	"breakdown" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gameweek_scores_user_id_gameweek_id_pk" PRIMARY KEY("user_id","gameweek_id")
);
--> statement-breakpoint
CREATE TABLE "gameweeks" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"number" integer NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"first_kickoff_at" timestamp with time zone NOT NULL,
	"last_kickoff_at" timestamp with time zone NOT NULL,
	"finalise_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"locked_at" timestamp with time zone,
	"finalised_at" timestamp with time zone,
	"scoring_version" text
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"league_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "league_members_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"send_after" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"suppressed" text,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"rarity" text,
	"status" text DEFAULT 'sealed' NOT NULL,
	"grant_key" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"odds_version" text,
	"seed" text,
	"result" jsonb,
	CONSTRAINT "packs_grant_key_unique" UNIQUE("grant_key")
);
--> statement-breakpoint
CREATE TABLE "player_match_stats" (
	"player_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"club_id" text NOT NULL,
	"stats" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_match_stats_player_id_fixture_id_pk" PRIMARY KEY("player_id","fixture_id")
);
--> statement-breakpoint
CREATE TABLE "player_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"to_club_id" text,
	"registered_at" timestamp with time zone NOT NULL,
	"effective_gameweek_id" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_ref" text NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"shirt_number" integer,
	"club_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"rating" integer NOT NULL,
	"photo_url" text,
	CONSTRAINT "players_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "selections" (
	"user_id" text NOT NULL,
	"gameweek_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"carried_over" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "selections_user_id_gameweek_id_pk" PRIMARY KEY("user_id","gameweek_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_slots" (
	"user_id" text NOT NULL,
	"slot" integer NOT NULL,
	"card_id" text NOT NULL,
	CONSTRAINT "squad_slots_user_id_slot_pk" PRIMARY KEY("user_id","slot")
);
--> statement-breakpoint
CREATE TABLE "stat_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"revision" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"applied" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_hash" text NOT NULL,
	"display_name" text,
	"favourite_club_id" text,
	"age_confirmed_at" timestamp with time zone,
	"disclaimer_accepted_at" timestamp with time zone,
	"invite_code" text NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_hash_unique" UNIQUE("phone_hash"),
	CONSTRAINT "users_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_club_at_opening_id_clubs_id_fk" FOREIGN KEY ("club_at_opening_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_gameweek_id_gameweeks_id_fk" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_club_id_clubs_id_fk" FOREIGN KEY ("home_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_club_id_clubs_id_fk" FOREIGN KEY ("away_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameweek_scores" ADD CONSTRAINT "gameweek_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameweek_scores" ADD CONSTRAINT "gameweek_scores_gameweek_id_gameweeks_id_fk" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_moves" ADD CONSTRAINT "player_moves_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_moves" ADD CONSTRAINT "player_moves_to_club_id_clubs_id_fk" FOREIGN KEY ("to_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_moves" ADD CONSTRAINT "player_moves_effective_gameweek_id_gameweeks_id_fk" FOREIGN KEY ("effective_gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_gameweek_id_gameweeks_id_fk" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_slots" ADD CONSTRAINT "squad_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_slots" ADD CONSTRAINT "squad_slots_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_favourite_club_id_clubs_id_fk" FOREIGN KEY ("favourite_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_user" ON "cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cards_player" ON "cards" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "ledger_user" ON "coin_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "config_versions_kind_version_season" ON "config_versions" USING btree ("kind","version","season");--> statement-breakpoint
CREATE INDEX "fixtures_gw" ON "fixtures" USING btree ("gameweek_id");--> statement-breakpoint
CREATE INDEX "scores_gw" ON "gameweek_scores" USING btree ("gameweek_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gameweeks_season_number" ON "gameweeks" USING btree ("season","number");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "packs_user" ON "packs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pms_fixture" ON "player_match_stats" USING btree ("fixture_id");--> statement-breakpoint
CREATE INDEX "players_club" ON "players" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_card" ON "squad_slots" USING btree ("card_id");