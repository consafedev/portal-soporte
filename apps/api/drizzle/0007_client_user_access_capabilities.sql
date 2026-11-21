CREATE TABLE "portal"."client_capabilities" (
	"client_id" uuid NOT NULL,
	"capability_id" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_capabilities_pkey" PRIMARY KEY("client_id","capability_id"),
	CONSTRAINT "client_capabilities_id_check" CHECK ("portal"."client_capabilities"."capability_id" IN ('rf-1:read', 'rf-1:execute')),
	CONSTRAINT "client_capabilities_execute_disabled_check" CHECK ("portal"."client_capabilities"."capability_id" <> 'rf-1:execute' OR "portal"."client_capabilities"."enabled" = false)
);
--> statement-breakpoint
CREATE TABLE "portal"."client_user_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "client_user_assignments_revocation_metadata_check" CHECK (("portal"."client_user_assignments"."revoked_by_user_id" IS NULL AND "portal"."client_user_assignments"."revoked_at" IS NULL) OR ("portal"."client_user_assignments"."revoked_by_user_id" IS NOT NULL AND "portal"."client_user_assignments"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "portal"."client_capabilities" ADD CONSTRAINT "client_capabilities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "portal"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_capabilities" ADD CONSTRAINT "client_capabilities_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "portal"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_user_assignments" ADD CONSTRAINT "client_user_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "portal"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_user_assignments" ADD CONSTRAINT "client_user_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "portal"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_user_assignments" ADD CONSTRAINT "client_user_assignments_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "portal"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_user_assignments" ADD CONSTRAINT "client_user_assignments_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "portal"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_user_assignments_active_pair_unique" ON "portal"."client_user_assignments" USING btree ("client_id","user_id") WHERE "portal"."client_user_assignments"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "client_user_assignments_user_id_idx" ON "portal"."client_user_assignments" USING btree ("user_id") WHERE "portal"."client_user_assignments"."revoked_at" IS NULL;