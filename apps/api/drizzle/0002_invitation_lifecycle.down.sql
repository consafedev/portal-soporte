-- Reversión manual de 0002; conserva las invitaciones canceladas como pendientes sin token vigente.
-- Tras revertir, un administrador deberá volver a emitir el enlace antes de que la cuenta pueda activarse.
UPDATE "portal"."users"
SET "status" = 'PENDING_ACTIVATION'
WHERE "status" = 'DISABLED'
  AND "password_hash" IS NULL
  AND "email_verified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "portal"."users" DROP CONSTRAINT "users_credential_state_check";--> statement-breakpoint
ALTER TABLE "portal"."users" ADD CONSTRAINT "users_credential_state_check"
  CHECK (("users"."status" = 'PENDING_ACTIVATION' AND "users"."password_hash" IS NULL)
    OR ("users"."status" IN ('ACTIVE', 'DISABLED') AND "users"."password_hash" IS NOT NULL));
