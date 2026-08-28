CREATE TYPE "LicenseCategory" AS ENUM ('permissive', 'copyleft', 'no_license', 'unknown', 'restricted');
CREATE TYPE "CandidateStatus" AS ENUM ('candidate', 'review', 'excluded');
CREATE TYPE "ReadmeStatus" AS ENUM ('pending', 'fetched', 'missing', 'failed');
CREATE TYPE "RepositoryKind" AS ENUM ('application', 'library', 'framework', 'cli_tool', 'dev_tool', 'awesome_list', 'book', 'course', 'tutorial', 'algorithm_collection', 'resource_collection', 'config', 'starter', 'boilerplate', 'unknown');

ALTER TABLE "repositories"
ADD COLUMN "license_category" "LicenseCategory" NOT NULL DEFAULT 'unknown',
ADD COLUMN "license_review_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "commercial_bundle_candidate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "candidate_status" "CandidateStatus" NOT NULL DEFAULT 'review',
ADD COLUMN "readme_raw" TEXT,
ADD COLUMN "readme_text" TEXT,
ADD COLUMN "readme_sha" TEXT,
ADD COLUMN "readme_updated_at" TIMESTAMPTZ(3),
ADD COLUMN "readme_status" "ReadmeStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "product_likeness_score" INTEGER,
ADD COLUMN "repository_kind" "RepositoryKind" NOT NULL DEFAULT 'unknown',
ADD COLUMN "product_likeness_reasons" JSONB,
ADD COLUMN "template_potential_score" INTEGER;

CREATE INDEX "repositories_license_category_candidate_status_idx" ON "repositories"("license_category", "candidate_status");
CREATE INDEX "repositories_readme_status_readme_updated_at_idx" ON "repositories"("readme_status", "readme_updated_at");
CREATE INDEX "repositories_repository_kind_template_potential_score_idx" ON "repositories"("repository_kind", "template_potential_score");
