ALTER TABLE "report_file" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_file" ADD COLUMN "file_url" text;