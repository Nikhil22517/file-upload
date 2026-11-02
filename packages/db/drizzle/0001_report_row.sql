CREATE TABLE "report_row" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"definition_key" text,
	"template_id" uuid,
	"line" integer NOT NULL,
	"driver_key" text,
	"driver_name" text,
	"day" date,
	"year" integer,
	"week" integer,
	"data" jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_row_fileId_line_unique" UNIQUE("file_id","line")
);
--> statement-breakpoint
ALTER TABLE "report_file" ADD COLUMN "row_count" integer;--> statement-breakpoint
ALTER TABLE "report_file" ADD COLUMN "issue_count" integer;--> statement-breakpoint
ALTER TABLE "report_file" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "report_row" ADD CONSTRAINT "report_row_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_row" ADD CONSTRAINT "report_row_file_id_report_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."report_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_row" ADD CONSTRAINT "report_row_template_id_report_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_row_ws_driver" ON "report_row" USING btree ("workspace_id","driver_key","day");--> statement-breakpoint
CREATE INDEX "report_row_ws_report" ON "report_row" USING btree ("workspace_id","definition_key","template_id","day");