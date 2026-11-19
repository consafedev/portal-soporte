ALTER TABLE "portal"."auth_throttle_windows" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "portal"."auth_throttle_windows"
SET "expires_at" = "window_started_at" + interval '15 minutes'
WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_throttle_expires_at_idx" ON "portal"."auth_throttle_windows" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" ADD CONSTRAINT "auth_throttle_expiration_check" CHECK ("auth_throttle_windows"."expires_at" > '1970-01-01T00:00:00Z'::timestamptz);
