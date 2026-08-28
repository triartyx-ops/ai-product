CREATE TYPE "AiAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiPoolSource" AS ENUM ('CANDIDATE', 'REVIEW');
CREATE TYPE "AiShortlistTier" AS ENUM ('STRONG', 'POSSIBLE', 'WEAK', 'REJECT');
CREATE TYPE "AiProductCategory" AS ENUM ('CRM','ERP','PROJECT_MANAGEMENT','BOOKING','ECOMMERCE','CMS','ANALYTICS','DASHBOARD','CUSTOMER_SUPPORT','KNOWLEDGE_BASE','HR','FINANCE','INVOICING','MARKETING','AUTOMATION','AI_ASSISTANT','AI_AGENT','CONTENT','SOCIAL_MEDIA','COMMUNICATION','PRODUCTIVITY','FILE_MANAGEMENT','SECURITY','DEVELOPER_PRODUCT','OTHER');

CREATE TABLE "ai_analysis_runs" (
  "id" BIGSERIAL PRIMARY KEY, "analysis_version" TEXT NOT NULL UNIQUE, "prompt_version" TEXT NOT NULL,
  "model" TEXT NOT NULL, "status" "AiAnalysisStatus" NOT NULL DEFAULT 'PENDING', "pool_size" INTEGER NOT NULL DEFAULT 0,
  "completed_count" INTEGER NOT NULL DEFAULT 0, "error_count" INTEGER NOT NULL DEFAULT 0, "api_requests" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0, "output_tokens" INTEGER NOT NULL DEFAULT 0, "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "repository_ai_analyses" (
  "id" BIGSERIAL PRIMARY KEY, "repository_id" BIGINT NOT NULL, "run_id" BIGINT NOT NULL, "analysis_version" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL, "model" TEXT NOT NULL, "pool_rank" INTEGER NOT NULL, "pool_source" "AiPoolSource" NOT NULL,
  "status" "AiAnalysisStatus" NOT NULL DEFAULT 'PENDING', "input_fingerprint" TEXT NOT NULL,
  "ai_repository_kind" "RepositoryKind", "actual_product_name" TEXT, "product_category" "AiProductCategory",
  "short_product_description" TEXT, "is_complete_application" BOOLEAN, "can_be_self_hosted" BOOLEAN, "has_meaningful_ui" BOOLEAN,
  "requires_complex_infrastructure" BOOLEAN, "can_be_rebranded" BOOLEAN, "can_be_used_as_client_project" BOOLEAN,
  "target_users" JSONB, "business_use_cases" JSONB, "major_setup_dependencies" JSONB, "potential_bundle_positioning" TEXT,
  "analysis_confidence" INTEGER, "product_completeness_score" INTEGER, "business_usefulness_score" INTEGER,
  "ease_of_deployment_score" INTEGER, "ease_of_customization_score" INTEGER, "visual_demo_value_score" INTEGER,
  "client_resale_potential_score" INTEGER, "bundle_uniqueness_score" INTEGER, "commercial_bundle_score" INTEGER,
  "shortlist_tier" "AiShortlistTier", "bundle_score_reasons" JSONB, "raw_response" JSONB, "analyzed_at" TIMESTAMPTZ(3),
  "error_code" TEXT, "error_message" TEXT, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "repository_ai_analyses_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE,
  CONSTRAINT "repository_ai_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_analysis_runs"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "repository_ai_analyses_repository_id_analysis_version_key" ON "repository_ai_analyses"("repository_id", "analysis_version");
CREATE INDEX "repository_ai_analyses_analysis_version_status_idx" ON "repository_ai_analyses"("analysis_version", "status");
CREATE INDEX "repository_ai_analyses_analysis_version_shortlist_tier_commercial_bundle_score_idx" ON "repository_ai_analyses"("analysis_version", "shortlist_tier", "commercial_bundle_score");
CREATE INDEX "repository_ai_analyses_analysis_version_product_category_idx" ON "repository_ai_analyses"("analysis_version", "product_category");
