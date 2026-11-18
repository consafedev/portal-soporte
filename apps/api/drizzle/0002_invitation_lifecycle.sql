-- Alcance: restringe `users` para permitir invitaciones canceladas sin hash solo antes de verificar correo.
-- Reversión: devolver esas cuentas a `PENDING_ACTIVATION` y restaurar el CHECK previo.
ALTER TABLE "users" DROP CONSTRAINT "users_credential_state_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_credential_state_check" CHECK (("users"."status" = 'PENDING_ACTIVATION' AND "users"."password_hash" IS NULL AND "users"."email_verified_at" IS NULL) OR ("users"."status" = 'DISABLED' AND "users"."password_hash" IS NULL AND "users"."email_verified_at" IS NULL) OR ("users"."status" IN ('ACTIVE', 'DISABLED') AND "users"."password_hash" IS NOT NULL));
