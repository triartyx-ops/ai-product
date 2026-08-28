-- CreateEnum
CREATE TYPE "GitHubSearchQueryStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RATE_LIMITED');

-- CreateTable
CREATE TABLE "github_search_queries" (
    "id" BIGSERIAL NOT NULL,
    "target_business_category" "AiProductCategory" NOT NULL,
    "search_query" TEXT NOT NULL,
    "status" "GitHubSearchQueryStatus" NOT NULL DEFAULT 'PENDING',
    "total_count" INTEGER,
    "raw_results" INTEGER NOT NULL DEFAULT 0,
    "pages_processed" INTEGER NOT NULL DEFAULT 0,
    "incomplete_results" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "github_search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_search_queries_search_query_key" ON "github_search_queries"("search_query");

-- CreateIndex
CREATE INDEX "github_search_queries_target_business_category_status_idx" ON "github_search_queries"("target_business_category", "status");
