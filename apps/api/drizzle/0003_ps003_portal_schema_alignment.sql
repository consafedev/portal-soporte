ALTER TABLE "portal"."audit_events" DROP CONSTRAINT "audit_events_outcome_check";--> statement-breakpoint
ALTER TABLE "portal"."auth_invariants" DROP CONSTRAINT "auth_invariants_singleton_check";--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" DROP CONSTRAINT "auth_throttle_scope_check";--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" DROP CONSTRAINT "auth_throttle_attempt_count_check";--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" DROP CONSTRAINT "auth_throttle_expiration_check";--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" DROP CONSTRAINT "recovery_tokens_purpose_check";--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" DROP CONSTRAINT "recovery_tokens_target_email_check";--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" DROP CONSTRAINT "recovery_tokens_expiration_check";--> statement-breakpoint
ALTER TABLE "portal"."users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "portal"."users" DROP CONSTRAINT "users_status_check";--> statement-breakpoint
ALTER TABLE "portal"."users" DROP CONSTRAINT "users_credential_state_check";--> statement-breakpoint
ALTER TABLE "portal"."audit_events" DROP CONSTRAINT "audit_events_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "portal"."audit_events" DROP CONSTRAINT "audit_events_target_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" DROP CONSTRAINT "recovery_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "portal"."sessions" DROP CONSTRAINT "sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "portal"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "portal"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."audit_events" ADD CONSTRAINT "audit_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "portal"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" ADD CONSTRAINT "recovery_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."audit_events" ADD CONSTRAINT "audit_events_outcome_check" CHECK ("portal"."audit_events"."outcome" IN ('SUCCESS', 'FAILURE', 'DENIED'));--> statement-breakpoint
ALTER TABLE "portal"."auth_invariants" ADD CONSTRAINT "auth_invariants_singleton_check" CHECK ("portal"."auth_invariants"."id" = 1);--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" ADD CONSTRAINT "auth_throttle_scope_check" CHECK ("portal"."auth_throttle_windows"."scope" IN ('LOGIN_ACCOUNT', 'LOGIN_NETWORK', 'RECOVERY_ACCOUNT', 'RECOVERY_NETWORK'));--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" ADD CONSTRAINT "auth_throttle_attempt_count_check" CHECK ("portal"."auth_throttle_windows"."attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "portal"."auth_throttle_windows" ADD CONSTRAINT "auth_throttle_expiration_check" CHECK ("portal"."auth_throttle_windows"."expires_at" > '1970-01-01T00:00:00Z'::timestamptz);--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" ADD CONSTRAINT "recovery_tokens_purpose_check" CHECK ("portal"."recovery_tokens"."purpose" IN ('ACTIVATION', 'PASSWORD_RECOVERY', 'EMAIL_CHANGE', 'EMAIL_VERIFICATION'));--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" ADD CONSTRAINT "recovery_tokens_target_email_check" CHECK (("portal"."recovery_tokens"."purpose" = 'EMAIL_CHANGE' AND "portal"."recovery_tokens"."target_email" IS NOT NULL) OR ("portal"."recovery_tokens"."purpose" <> 'EMAIL_CHANGE' AND "portal"."recovery_tokens"."target_email" IS NULL));--> statement-breakpoint
ALTER TABLE "portal"."recovery_tokens" ADD CONSTRAINT "recovery_tokens_expiration_check" CHECK ("portal"."recovery_tokens"."expires_at" > '1970-01-01T00:00:00Z'::timestamptz);--> statement-breakpoint
ALTER TABLE "portal"."users" ADD CONSTRAINT "users_role_check" CHECK ("portal"."users"."role" IN ('ADMIN', 'SUPPORT'));--> statement-breakpoint
ALTER TABLE "portal"."users" ADD CONSTRAINT "users_status_check" CHECK ("portal"."users"."status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED'));--> statement-breakpoint
ALTER TABLE "portal"."users" ADD CONSTRAINT "users_credential_state_check" CHECK (("portal"."users"."status" = 'PENDING_ACTIVATION' AND "portal"."users"."password_hash" IS NULL AND "portal"."users"."email_verified_at" IS NULL) OR ("portal"."users"."status" = 'DISABLED' AND "portal"."users"."password_hash" IS NULL AND "portal"."users"."email_verified_at" IS NULL) OR ("portal"."users"."status" IN ('ACTIVE', 'DISABLED') AND "portal"."users"."password_hash" IS NOT NULL));