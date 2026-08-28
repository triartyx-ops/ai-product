-- CreateEnum
CREATE TYPE "BusinessAnalysisSource" AS ENUM ('NEW_AI', 'REUSED_EXISTING');

-- CreateEnum
CREATE TYPE "ComplexityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BusinessProductCategory" AS ENUM ('CRM', 'SALES', 'BOOKING', 'HR', 'ATS', 'INVOICING', 'ACCOUNTING', 'FINANCE', 'ERP', 'POS', 'INVENTORY', 'ECOMMERCE', 'CUSTOMER_SUPPORT', 'PROJECT_MANAGEMENT', 'PROPERTY_MANAGEMENT', 'REAL_ESTATE', 'RESTAURANT', 'HOTEL', 'LMS', 'CLIENT_PORTAL', 'FORMS', 'SURVEYS', 'MARKETING', 'EMAIL_MARKETING', 'SOCIAL_MEDIA', 'TIME_TRACKING', 'PAYROLL', 'DOCUMENT_MANAGEMENT', 'CMS', 'ANALYTICS', 'DASHBOARD', 'AUTOMATION', 'PRODUCTIVITY', 'OTHER');

-- CreateTable
CREATE TABLE "business_ai_selection_runs" (
    "id" BIGSERIAL NOT NULL,
    "selection_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "eligible_count" INTEGER NOT NULL DEFAULT 0,
    "reused_count" INTEGER NOT NULL DEFAULT 0,
    "analyzed_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "api_requests" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_ai_selection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_business_ai_analyses" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "run_id" BIGINT NOT NULL,
    "selection_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "source" "BusinessAnalysisSource" NOT NULL,
    "reused_from_ai_analysis_id" BIGINT,
    "status" "AiAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "input_fingerprint" TEXT NOT NULL,
    "target_business_categories" JSONB NOT NULL,
    "search_queries" JSONB NOT NULL,
    "actual_product_name" TEXT,
    "product_category" "BusinessProductCategory",
    "secondary_categories" JSONB,
    "short_product_description" TEXT,
    "what_user_gets" TEXT,
    "target_users" JSONB,
    "business_use_cases" JSONB,
    "is_complete_application" BOOLEAN,
    "is_self_hostable" BOOLEAN,
    "has_meaningful_ui" BOOLEAN,
    "has_demo_or_screenshots" BOOLEAN,
    "can_be_rebranded" BOOLEAN,
    "can_be_used_for_client_projects" BOOLEAN,
    "requires_complex_infrastructure" BOOLEAN,
    "major_dependencies" JSONB,
    "likely_setup_complexity" "ComplexityLevel",
    "likely_customization_complexity" "ComplexityLevel",
    "commercial_risks" JSONB,
    "analysis_confidence" INTEGER,
    "product_completeness_score" INTEGER,
    "business_usefulness_score" INTEGER,
    "ease_of_deployment_score" INTEGER,
    "ease_of_customization_score" INTEGER,
    "visual_value_score" INTEGER,
    "client_project_potential_score" INTEGER,
    "end_user_clarity_score" INTEGER,
    "bundle_uniqueness_score" INTEGER,
    "commercial_bundle_score" INTEGER,
    "shortlist_tier" "AiShortlistTier",
    "commercial_bundle_reasons" JSONB,
    "buyer_value_proposition" TEXT,
    "client_project_examples" JSONB,
    "quality_audit_status" TEXT,
    "quality_audit_notes" TEXT,
    "quality_audited_at" TIMESTAMPTZ(3),
    "raw_response" JSONB,
    "analyzed_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "repository_business_ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_candidate_pool_v3" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "repository_ai_analysis_id" BIGINT,
    "business_ai_analysis_id" BIGINT,
    "origin" TEXT NOT NULL,
    "shortlist_tier" "AiShortlistTier" NOT NULL,
    "bundle_score" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "buyer_value_proposition" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commercial_candidate_pool_v3_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deep_test_shortlist_v1" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "candidate_pool_id" BIGINT NOT NULL,
    "rank" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "bundle_score" INTEGER NOT NULL,
    "selection_score" INTEGER NOT NULL,
    "reason_selected" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deep_test_shortlist_v1_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_ai_selection_runs_selection_version_key" ON "business_ai_selection_runs"("selection_version");

-- CreateIndex
CREATE INDEX "repository_business_ai_analyses_selection_version_status_idx" ON "repository_business_ai_analyses"("selection_version", "status");

-- CreateIndex
CREATE INDEX "repository_business_ai_analyses_selection_version_shortlist_idx" ON "repository_business_ai_analyses"("selection_version", "shortlist_tier", "commercial_bundle_score");

-- CreateIndex
CREATE INDEX "repository_business_ai_analyses_selection_version_product_c_idx" ON "repository_business_ai_analyses"("selection_version", "product_category");

-- CreateIndex
CREATE UNIQUE INDEX "repository_business_ai_analyses_repository_id_selection_ver_key" ON "repository_business_ai_analyses"("repository_id", "selection_version");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_candidate_pool_v3_repository_id_key" ON "commercial_candidate_pool_v3"("repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_candidate_pool_v3_business_ai_analysis_id_key" ON "commercial_candidate_pool_v3"("business_ai_analysis_id");

-- CreateIndex
CREATE INDEX "commercial_candidate_pool_v3_shortlist_tier_bundle_score_idx" ON "commercial_candidate_pool_v3"("shortlist_tier", "bundle_score");

-- CreateIndex
CREATE INDEX "commercial_candidate_pool_v3_category_idx" ON "commercial_candidate_pool_v3"("category");

-- CreateIndex
CREATE UNIQUE INDEX "deep_test_shortlist_v1_repository_id_key" ON "deep_test_shortlist_v1"("repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "deep_test_shortlist_v1_candidate_pool_id_key" ON "deep_test_shortlist_v1"("candidate_pool_id");

-- CreateIndex
CREATE UNIQUE INDEX "deep_test_shortlist_v1_rank_key" ON "deep_test_shortlist_v1"("rank");

-- CreateIndex
CREATE INDEX "deep_test_shortlist_v1_category_rank_idx" ON "deep_test_shortlist_v1"("category", "rank");

-- AddForeignKey
ALTER TABLE "repository_business_ai_analyses" ADD CONSTRAINT "repository_business_ai_analyses_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_business_ai_analyses" ADD CONSTRAINT "repository_business_ai_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "business_ai_selection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_candidate_pool_v3" ADD CONSTRAINT "commercial_candidate_pool_v3_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_candidate_pool_v3" ADD CONSTRAINT "commercial_candidate_pool_v3_business_ai_analysis_id_fkey" FOREIGN KEY ("business_ai_analysis_id") REFERENCES "repository_business_ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deep_test_shortlist_v1" ADD CONSTRAINT "deep_test_shortlist_v1_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deep_test_shortlist_v1" ADD CONSTRAINT "deep_test_shortlist_v1_candidate_pool_id_fkey" FOREIGN KEY ("candidate_pool_id") REFERENCES "commercial_candidate_pool_v3"("id") ON DELETE CASCADE ON UPDATE CASCADE;
