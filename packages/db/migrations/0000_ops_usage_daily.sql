-- 0000_ops_usage_daily (M0-W1-T03). First migration: the standalone ops table of data-model.md section 3.12.
-- Unqualified on purpose: the migrator runs with search_path set to DB_SCHEMA (prod | staging), so the table is created
-- inside that schema. Index: the primary key on "day" serves the 10-minute upsert and the 400-day retention delete;
-- no secondary index is justified for about 400 rows. Forward-only; never edit after merge.
CREATE TABLE "ops_usage_daily" (
	"day" date PRIMARY KEY NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL,
	"bytes_in" bigint DEFAULT 0 NOT NULL,
	"bot_bytes_out" bigint DEFAULT 0 NOT NULL,
	"instance_seconds" bigint DEFAULT 0 NOT NULL,
	"room_seconds" bigint DEFAULT 0 NOT NULL,
	"player_seconds" bigint DEFAULT 0 NOT NULL,
	"peak_clients" smallint DEFAULT 0 NOT NULL,
	"peak_rooms" smallint DEFAULT 0 NOT NULL,
	"rooms_refused" integer DEFAULT 0 NOT NULL,
	"boots" smallint DEFAULT 0 NOT NULL,
	"db_bytes" bigint DEFAULT 0 NOT NULL,
	"saves_bytes" bigint DEFAULT 0 NOT NULL,
	"contracts_by_tier" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
