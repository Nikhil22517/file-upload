CREATE TABLE "report_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"format" text NOT NULL,
	"storage_key" text NOT NULL,
	"detected_key" text,
	"definition_key" text,
	"template_id" uuid,
	"confidence" real,
	"header_row" integer,
	"stage" text NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings_accepted" boolean DEFAULT false NOT NULL,
	"context" jsonb,
	"reference_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"header_row" integer,
	"headers" jsonb NOT NULL,
	"header_signature" text NOT NULL,
	"file_name_pattern" text NOT NULL,
	"columns" jsonb NOT NULL,
	"period_source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_template_workspaceId_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "report_file" ADD CONSTRAINT "report_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_file" ADD CONSTRAINT "report_file_template_id_report_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template" ADD CONSTRAINT "report_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_file_ws_sha" ON "report_file" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "report_file_ws_created" ON "report_file" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "report_template_ws_sig" ON "report_template" USING btree ("workspace_id","header_signature");