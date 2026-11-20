CREATE TABLE "portal"."user_mfa_factors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seed_nonce" varchar(16) NOT NULL,
	"seed_ciphertext" varchar(27) NOT NULL,
	"seed_tag" varchar(22) NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_totp_counter" numeric(20, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_factors_nonce_check" CHECK ("portal"."user_mfa_factors"."seed_nonce" ~ '^[A-Za-z0-9_-]{16}$'),
	CONSTRAINT "user_mfa_factors_ciphertext_check" CHECK ("portal"."user_mfa_factors"."seed_ciphertext" ~ '^[A-Za-z0-9_-]{26}[AEIMQUYcgkosw048]$'),
	CONSTRAINT "user_mfa_factors_tag_check" CHECK ("portal"."user_mfa_factors"."seed_tag" ~ '^[A-Za-z0-9_-]{21}[AEIMQUYcgkosw048]$'),
	CONSTRAINT "user_mfa_factors_counter_check" CHECK ("portal"."user_mfa_factors"."last_totp_counter" IS NULL OR ("portal"."user_mfa_factors"."last_totp_counter" >= 0 AND "portal"."user_mfa_factors"."last_totp_counter" <= 18446744073709551615)),
	CONSTRAINT "user_mfa_factors_enabled_counter_check" CHECK (("portal"."user_mfa_factors"."enabled_at" IS NULL AND "portal"."user_mfa_factors"."last_totp_counter" IS NULL) OR ("portal"."user_mfa_factors"."enabled_at" IS NOT NULL AND "portal"."user_mfa_factors"."last_totp_counter" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "portal"."user_mfa_recovery_codes" (
	"user_id" uuid NOT NULL,
	"digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "user_mfa_recovery_codes_pk" PRIMARY KEY("user_id","digest"),
	CONSTRAINT "user_mfa_recovery_codes_digest_check" CHECK ("portal"."user_mfa_recovery_codes"."digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "portal"."user_mfa_factors" ADD CONSTRAINT "user_mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_user_mfa_factors_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal"."user_mfa_factors"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_mfa_recovery_codes_user_consumed_idx" ON "portal"."user_mfa_recovery_codes" USING btree ("user_id","consumed_at");
