-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiPoolSource" ADD VALUE 'GAP_FILL';
ALTER TYPE "AiPoolSource" ADD VALUE 'FALSE_NEGATIVE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiProductCategory" ADD VALUE 'SALES';
ALTER TYPE "AiProductCategory" ADD VALUE 'LEAD_MANAGEMENT';
ALTER TYPE "AiProductCategory" ADD VALUE 'APPOINTMENTS';
ALTER TYPE "AiProductCategory" ADD VALUE 'CALENDAR_BUSINESS';
ALTER TYPE "AiProductCategory" ADD VALUE 'INVENTORY';
ALTER TYPE "AiProductCategory" ADD VALUE 'POS';
ALTER TYPE "AiProductCategory" ADD VALUE 'HELPDESK';
ALTER TYPE "AiProductCategory" ADD VALUE 'LIVE_CHAT';
ALTER TYPE "AiProductCategory" ADD VALUE 'HRM';
ALTER TYPE "AiProductCategory" ADD VALUE 'ATS';
ALTER TYPE "AiProductCategory" ADD VALUE 'ACCOUNTING';
ALTER TYPE "AiProductCategory" ADD VALUE 'EXPENSES';
ALTER TYPE "AiProductCategory" ADD VALUE 'PAYROLL';
ALTER TYPE "AiProductCategory" ADD VALUE 'EMAIL_MARKETING';
ALTER TYPE "AiProductCategory" ADD VALUE 'PROPERTY_MANAGEMENT';
ALTER TYPE "AiProductCategory" ADD VALUE 'REAL_ESTATE';
ALTER TYPE "AiProductCategory" ADD VALUE 'RESTAURANT';
ALTER TYPE "AiProductCategory" ADD VALUE 'HOTEL';
ALTER TYPE "AiProductCategory" ADD VALUE 'LMS';
ALTER TYPE "AiProductCategory" ADD VALUE 'COURSE_PLATFORM';
ALTER TYPE "AiProductCategory" ADD VALUE 'FORM_BUILDER';
ALTER TYPE "AiProductCategory" ADD VALUE 'SURVEY';
ALTER TYPE "AiProductCategory" ADD VALUE 'TIME_TRACKING';
ALTER TYPE "AiProductCategory" ADD VALUE 'DOCUMENT_MANAGEMENT';
ALTER TYPE "AiProductCategory" ADD VALUE 'CLIENT_PORTAL';
ALTER TYPE "AiProductCategory" ADD VALUE 'SUBSCRIPTION_MANAGEMENT';

-- DropForeignKey
ALTER TABLE "repository_ai_analyses" DROP CONSTRAINT "repository_ai_analyses_repository_id_fkey";

-- DropForeignKey
ALTER TABLE "repository_ai_analyses" DROP CONSTRAINT "repository_ai_analyses_run_id_fkey";

-- AlterTable
ALTER TABLE "repository_ai_analyses" ADD COLUMN     "buyer_value_proposition" TEXT,
ADD COLUMN     "client_project_examples" JSONB,
ADD COLUMN     "discovery_reason" TEXT,
ADD COLUMN     "previous_score" INTEGER,
ADD COLUMN     "previous_stage_status" "AiShortlistTier",
ADD COLUMN     "reevaluation_reason" TEXT,
ADD COLUMN     "score_changed" BOOLEAN,
ADD COLUMN     "score_delta" INTEGER;

-- CreateTable
CREATE TABLE "business_gap_discoveries" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "discovery_version" TEXT NOT NULL,
    "primary_category" "AiProductCategory" NOT NULL,
    "matched_categories" JSONB NOT NULL,
    "discovery_reasons" JSONB NOT NULL,
    "discovery_score" INTEGER NOT NULL,
    "standalone_score" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_gap_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_candidate_pool_v2" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "analysis_id" BIGINT NOT NULL,
    "origin" TEXT NOT NULL,
    "shortlist_tier" "AiShortlistTier" NOT NULL,
    "bundle_score" INTEGER NOT NULL,
    "product_category" "AiProductCategory" NOT NULL,
    "rescued" BOOLEAN NOT NULL DEFAULT false,
    "new_gap_fill" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commercial_candidate_pool_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_gap_discoveries_discovery_version_selected_primary_idx" ON "business_gap_discoveries"("discovery_version", "selected", "primary_category");

-- CreateIndex
CREATE UNIQUE INDEX "business_gap_discoveries_repository_id_discovery_version_key" ON "business_gap_discoveries"("repository_id", "discovery_version");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_candidate_pool_v2_repository_id_key" ON "commercial_candidate_pool_v2"("repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_candidate_pool_v2_analysis_id_key" ON "commercial_candidate_pool_v2"("analysis_id");

-- CreateIndex
CREATE INDEX "commercial_candidate_pool_v2_shortlist_tier_bundle_score_idx" ON "commercial_candidate_pool_v2"("shortlist_tier", "bundle_score");

-- CreateIndex
CREATE INDEX "commercial_candidate_pool_v2_product_category_idx" ON "commercial_candidate_pool_v2"("product_category");

-- AddForeignKey
ALTER TABLE "repository_ai_analyses" ADD CONSTRAINT "repository_ai_analyses_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_ai_analyses" ADD CONSTRAINT "repository_ai_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_gap_discoveries" ADD CONSTRAINT "business_gap_discoveries_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_candidate_pool_v2" ADD CONSTRAINT "commercial_candidate_pool_v2_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_candidate_pool_v2" ADD CONSTRAINT "commercial_candidate_pool_v2_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "repository_ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "repositories_github_enrichment_status_github_metadata_updated_a" RENAME TO "repositories_github_enrichment_status_github_metadata_updat_idx";

-- RenameIndex
ALTER INDEX "repository_ai_analyses_analysis_version_shortlist_tier_commerci" RENAME TO "repository_ai_analyses_analysis_version_shortlist_tier_comm_idx";

-- RenameIndex
ALTER INDEX "repository_discoveries_repository_url_telegram_message_id_sourc" RENAME TO "repository_discoveries_repository_url_telegram_message_id_s_key";
