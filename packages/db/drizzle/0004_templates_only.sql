-- Built-in report types are gone: every report is a template the workspace configures.
-- Uploads known only by a built-in type (no template) and not yet imported must be taught a template now;
-- a 'not sure which built-in report' warning no longer applies. Imported uploads keep their rows.
UPDATE "report_file" SET "warnings" = COALESCE(
  (SELECT jsonb_agg(w) FROM jsonb_array_elements("warnings") w WHERE w->>'code' <> 'low_confidence'), '[]'::jsonb)
WHERE "warnings" @> '[{"code": "low_confidence"}]';--> statement-breakpoint
UPDATE "report_file" SET "stage" = 'needs_template', "updated_at" = now()
WHERE "template_id" IS NULL AND ("stage" IN ('queued', 'needs_reference_date')
  OR ("stage" = 'needs_confirmation' AND "warnings" = '[]'::jsonb));--> statement-breakpoint
DROP INDEX "report_row_ws_report";--> statement-breakpoint
CREATE INDEX "report_row_ws_report" ON "report_row" USING btree ("workspace_id","template_id","day");--> statement-breakpoint
ALTER TABLE "report_file" DROP COLUMN "detected_key";--> statement-breakpoint
ALTER TABLE "report_file" DROP COLUMN "definition_key";--> statement-breakpoint
ALTER TABLE "report_file" DROP COLUMN "confidence";--> statement-breakpoint
ALTER TABLE "report_row" DROP COLUMN "definition_key";