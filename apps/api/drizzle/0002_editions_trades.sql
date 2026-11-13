CREATE TABLE "editions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"gameweek_id" text NOT NULL,
	"player_id" text NOT NULL,
	"supply" integer NOT NULL,
	"issued" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"offered_card_id" text NOT NULL,
	"requested_card_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "edition_id" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "serial" integer;--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "gameweek_id" text;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_gameweek_id_gameweeks_id_fk" FOREIGN KEY ("gameweek_id") REFERENCES "public"."gameweeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_offered_card_id_cards_id_fk" FOREIGN KEY ("offered_card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_requested_card_id_cards_id_fk" FOREIGN KEY ("requested_card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "editions_kind_gw_player" ON "editions" USING btree ("kind","gameweek_id","player_id");--> statement-breakpoint
CREATE INDEX "trades_from" ON "trades" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "trades_to" ON "trades" USING btree ("to_user_id");