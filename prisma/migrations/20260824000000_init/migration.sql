CREATE TYPE "CrawlStatus" AS ENUM ('DISCOVERED', 'PARSED', 'FAILED');
CREATE TYPE "CrawlJobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "telegram_messages" (
    "id" BIGSERIAL NOT NULL,
    "channel_username" TEXT NOT NULL,
    "telegram_message_id" BIGINT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "edited_at" TIMESTAMPTZ(3),
    "text" TEXT,
    "html" TEXT,
    "external_links" JSONB NOT NULL,
    "github_links" JSONB NOT NULL,
    "views" BIGINT,
    "raw_source" TEXT NOT NULL,
    "crawl_status" "CrawlStatus" NOT NULL DEFAULT 'PARSED',
    "crawled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crawl_jobs" (
    "id" BIGSERIAL NOT NULL,
    "channel_username" TEXT NOT NULL,
    "status" "CrawlJobStatus" NOT NULL DEFAULT 'RUNNING',
    "next_page_url" TEXT,
    "pages_processed" INTEGER NOT NULL DEFAULT 0,
    "messages_found" INTEGER NOT NULL DEFAULT 0,
    "github_links_found" INTEGER NOT NULL DEFAULT 0,
    "duplicates_skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crawl_failures" (
    "id" BIGSERIAL NOT NULL,
    "crawl_job_id" BIGINT NOT NULL,
    "page_url" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crawl_failures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_messages_channel_username_telegram_message_id_key"
ON "telegram_messages"("channel_username", "telegram_message_id");
CREATE INDEX "telegram_messages_channel_username_published_at_idx"
ON "telegram_messages"("channel_username", "published_at");
CREATE INDEX "crawl_jobs_channel_username_status_idx"
ON "crawl_jobs"("channel_username", "status");
CREATE INDEX "crawl_failures_crawl_job_id_created_at_idx"
ON "crawl_failures"("crawl_job_id", "created_at");

ALTER TABLE "crawl_failures"
ADD CONSTRAINT "crawl_failures_crawl_job_id_fkey"
FOREIGN KEY ("crawl_job_id") REFERENCES "crawl_jobs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
