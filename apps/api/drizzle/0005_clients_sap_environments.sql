CREATE TABLE "portal"."client_sap_environments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_sap_environments_code_check" CHECK ("portal"."client_sap_environments"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
	CONSTRAINT "client_sap_environments_status_check" CHECK ("portal"."client_sap_environments"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "client_sap_environments_name_check" CHECK (length(trim("portal"."client_sap_environments"."display_name")) >= 2)
);
--> statement-breakpoint
CREATE TABLE "portal"."clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_status_check" CHECK ("portal"."clients"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "clients_name_check" CHECK (length(trim("portal"."clients"."display_name")) >= 2)
);
--> statement-breakpoint
ALTER TABLE "portal"."client_sap_environments" ADD CONSTRAINT "client_sap_environments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "portal"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."clients" ADD CONSTRAINT "clients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "portal"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_sap_environments_client_code_unique" ON "portal"."client_sap_environments" USING btree ("client_id","code");--> statement-breakpoint
CREATE INDEX "client_sap_environments_client_id_idx" ON "portal"."client_sap_environments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_sap_environments_status_idx" ON "portal"."client_sap_environments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clients_display_name_idx" ON "portal"."clients" USING btree ("display_name");--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "portal"."clients" USING btree ("status");