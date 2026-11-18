CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"action" varchar(80) NOT NULL,
	"outcome" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_outcome_check" CHECK ("audit_events"."outcome" IN ('SUCCESS', 'FAILURE', 'DENIED'))
);
--> statement-breakpoint
CREATE TABLE "auth_invariants" (
	"id" smallint PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_invariants_singleton_check" CHECK ("auth_invariants"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "auth_invariants" ("id") VALUES (1);
--> statement-breakpoint
CREATE TABLE "auth_throttle_windows" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_throttle_scope_check" CHECK ("auth_throttle_windows"."scope" IN ('LOGIN_ACCOUNT', 'LOGIN_NETWORK', 'RECOVERY_ACCOUNT', 'RECOVERY_NETWORK')),
	CONSTRAINT "auth_throttle_attempt_count_check" CHECK ("auth_throttle_windows"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recovery_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" text NOT NULL,
	"target_email" varchar(254),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "recovery_tokens_purpose_check" CHECK ("recovery_tokens"."purpose" IN ('ACTIVATION', 'PASSWORD_RECOVERY', 'EMAIL_CHANGE', 'EMAIL_VERIFICATION')),
	CONSTRAINT "recovery_tokens_target_email_check" CHECK (("recovery_tokens"."purpose" = 'EMAIL_CHANGE' AND "recovery_tokens"."target_email" IS NOT NULL) OR ("recovery_tokens"."purpose" <> 'EMAIL_CHANGE' AND "recovery_tokens"."target_email" IS NULL)),
	CONSTRAINT "recovery_tokens_expiration_check" CHECK ("recovery_tokens"."expires_at" > '1970-01-01T00:00:00Z'::timestamptz)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"username_normalized" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_normalized" varchar(254) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('ADMIN', 'SUPPORT')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED')),
	CONSTRAINT "users_credential_state_check" CHECK (("users"."status" = 'PENDING_ACTIVATION' AND "users"."password_hash" IS NULL) OR ("users"."status" IN ('ACTIVE', 'DISABLED') AND "users"."password_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_created_idx" ON "audit_events" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recovery_tokens_expires_at_idx" ON "recovery_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "recovery_tokens_user_id_idx" ON "recovery_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_idle_expires_at_idx" ON "sessions" USING btree ("idle_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_normalized_unique" ON "users" USING btree ("username_normalized");
