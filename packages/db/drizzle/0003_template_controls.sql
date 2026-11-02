CREATE TABLE "report_metric" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"template_id" uuid,
	"metric_key" text NOT NULL,
	"metric_name" text NOT NULL,
	"group_by" text NOT NULL,
	"group_key" text NOT NULL,
	"group_label" text,
	"day" date,
	"year" integer,
	"week" integer,
	"value" double precision,
	"row_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_metric_fileId_metricKey_groupKey_unique" UNIQUE("file_id","metric_key","group_key")
);
--> statement-breakpoint
ALTER TABLE "report_file" ADD COLUMN "reference_week" text;--> statement-breakpoint
ALTER TABLE "report_template" ADD COLUMN "period_kind" text DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_template" ADD COLUMN "reader" text;--> statement-breakpoint
ALTER TABLE "report_template" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "report_template" ADD COLUMN "metrics" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_metric" ADD CONSTRAINT "report_metric_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metric" ADD CONSTRAINT "report_metric_file_id_report_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."report_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_metric" ADD CONSTRAINT "report_metric_template_id_report_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_metric_ws_template" ON "report_metric" USING btree ("workspace_id","template_id","metric_key");