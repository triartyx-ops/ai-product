CREATE TYPE "GitHubEnrichmentStatus" AS ENUM ('pending', 'processing', 'enriched', 'unavailable', 'rate_limited', 'failed');

ALTER TABLE "repositories"
ADD COLUMN "github_id" BIGINT,
ADD COLUMN "github_node_id" TEXT,
ADD COLUMN "github_owner_login" TEXT,
ADD COLUMN "github_owner_avatar" TEXT,
ADD COLUMN "github_name" TEXT,
ADD COLUMN "github_full_name" TEXT,
ADD COLUMN "github_canonical_url" TEXT,
ADD COLUMN "github_html_url" TEXT,
ADD COLUMN "github_description" TEXT,
ADD COLUMN "github_homepage" TEXT,
ADD COLUMN "github_stars" INTEGER,
ADD COLUMN "github_forks" INTEGER,
ADD COLUMN "github_watchers" INTEGER,
ADD COLUMN "github_open_issues" INTEGER,
ADD COLUMN "github_subscribers" INTEGER,
ADD COLUMN "github_primary_language" TEXT,
ADD COLUMN "github_topics" JSONB,
ADD COLUMN "github_size" INTEGER,
ADD COLUMN "github_default_branch" TEXT,
ADD COLUMN "github_created_at" TIMESTAMPTZ(3),
ADD COLUMN "github_updated_at" TIMESTAMPTZ(3),
ADD COLUMN "github_pushed_at" TIMESTAMPTZ(3),
ADD COLUMN "github_archived" BOOLEAN,
ADD COLUMN "github_disabled" BOOLEAN,
ADD COLUMN "github_fork" BOOLEAN,
ADD COLUMN "github_visibility" TEXT,
ADD COLUMN "github_license_spdx" TEXT,
ADD COLUMN "github_license_name" TEXT,
ADD COLUMN "github_license_url" TEXT,
ADD COLUMN "days_since_last_push" INTEGER,
ADD COLUMN "repository_age_days" INTEGER,
ADD COLUMN "github_enrichment_status" "GitHubEnrichmentStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "github_metadata_updated_at" TIMESTAMPTZ(3),
ADD COLUMN "github_error_code" TEXT,
ADD COLUMN "github_error_message" TEXT;

CREATE UNIQUE INDEX "repositories_github_id_key" ON "repositories"("github_id");
CREATE INDEX "repositories_github_enrichment_status_github_metadata_updated_at_idx"
ON "repositories"("github_enrichment_status", "github_metadata_updated_at");
