CREATE TABLE "portal"."client_connection_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"profile_type" text NOT NULL,
	"environment" text NOT NULL,
	"destination_id" varchar(64) NOT NULL,
	"gateway_id" varchar(64),
	"database_name" varchar(64) NOT NULL,
	"secret_envelope" jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_connection_profiles_type_check" CHECK ("portal"."client_connection_profiles"."profile_type" IN ('MYSQL_TCP', 'MYSQL_SSH')),
	CONSTRAINT "client_connection_profiles_environment_check" CHECK ("portal"."client_connection_profiles"."environment" IN ('PRODUCTION', 'TEST')),
	CONSTRAINT "client_connection_profiles_status_check" CHECK ("portal"."client_connection_profiles"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "client_connection_profiles_name_check" CHECK (length(trim("portal"."client_connection_profiles"."display_name")) >= 2),
	CONSTRAINT "client_connection_profiles_destination_check" CHECK ("portal"."client_connection_profiles"."destination_id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "client_connection_profiles_database_check" CHECK ("portal"."client_connection_profiles"."database_name" ~ '^[A-Za-z0-9_$-]{1,64}$'),
	CONSTRAINT "client_connection_profiles_gateway_check" CHECK (("portal"."client_connection_profiles"."profile_type" = 'MYSQL_SSH' AND "portal"."client_connection_profiles"."gateway_id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$') OR ("portal"."client_connection_profiles"."profile_type" = 'MYSQL_TCP' AND "portal"."client_connection_profiles"."gateway_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "portal"."client_connection_profiles" ADD CONSTRAINT "client_connection_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "portal"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_connection_profiles" ADD CONSTRAINT "client_connection_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "portal"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_connection_profiles_client_name_unique" ON "portal"."client_connection_profiles" USING btree ("client_id",lower("display_name"));--> statement-breakpoint
CREATE INDEX "client_connection_profiles_client_id_idx" ON "portal"."client_connection_profiles" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_connection_profiles_status_idx" ON "portal"."client_connection_profiles" USING btree ("status");