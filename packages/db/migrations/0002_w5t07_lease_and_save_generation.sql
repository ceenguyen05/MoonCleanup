-- 0002_w5t07_lease_and_save_generation (prepared by M1-W4-T05 for M1-W5-T07; no application logic uses these columns yet).
-- Expand step only: every column is nullable or defaulted, so code from before this migration keeps working.
--   contracts.lease_*             room lease, compare-and-set with the database clock (data-model.md section 3.5)
--   contract_saves.parent_seq     generation this save descends from (ADR-0031, data-model.md section 3.7c)
--   contract_saves.origin_kind    'room' (server checkpoint) or 'solo' (accepted local-first upload)
-- No new index: lease and save rows are always addressed by the Contract primary key. Forward-only; never edit after merge.
ALTER TABLE "contract_saves" ADD COLUMN "parent_seq" bigint;--> statement-breakpoint
ALTER TABLE "contract_saves" ADD COLUMN "origin_kind" text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "lease_instance" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "lease_room_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_saves" ADD CONSTRAINT "contract_saves_origin_kind_check" CHECK ("contract_saves"."origin_kind" in ('room', 'solo'));