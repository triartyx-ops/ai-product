CREATE TYPE "DeepStaticStatus" AS ENUM ('PENDING', 'PROCESSING', 'INSPECTED', 'CLONE_FAILED', 'FAILED');
CREATE TYPE "DeepStaticClassification" AS ENUM ('READY_FOR_SANDBOX', 'REVIEW', 'DROP');

CREATE TABLE "deep_static_inspection_runs" (
  "id" BIGSERIAL NOT NULL,
  "inspection_version" TEXT NOT NULL,
  "status" "DeepStaticStatus" NOT NULL DEFAULT 'PENDING',
  "target_count" INTEGER NOT NULL DEFAULT 0,
  "inspected_count" INTEGER NOT NULL DEFAULT 0,
  "clone_failure_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "deep_static_inspection_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "repository_deep_static_inspections" (
  "id" BIGSERIAL NOT NULL,
  "repository_id" BIGINT NOT NULL,
  "run_id" BIGINT NOT NULL,
  "inspection_version" TEXT NOT NULL,
  "status" "DeepStaticStatus" NOT NULL DEFAULT 'PENDING',
  "clone_path" TEXT,
  "clone_commit" TEXT,
  "clone_error" TEXT,
  "stack" JSONB,
  "frontend" JSONB,
  "backend" JSONB,
  "package_manager" TEXT,
  "is_monorepo" BOOLEAN NOT NULL DEFAULT false,
  "install_commands" JSONB,
  "runtime_commands" JSONB,
  "has_tests" BOOLEAN NOT NULL DEFAULT false,
  "docker" JSONB,
  "environment" JSONB,
  "database" JSONB,
  "migrations" JSONB,
  "seed_demo" JSONB,
  "external_services" JSONB,
  "paid_dependencies" JSONB,
  "deployment_configs" JSONB,
  "repository_size_bytes" BIGINT,
  "license_file" TEXT,
  "license_detected" TEXT,
  "license_matches_metadata" BOOLEAN,
  "suspicious_scripts" JSONB,
  "deprecated_dependencies" JSONB,
  "appears_standalone" BOOLEAN,
  "setup_complexity" "ComplexityLevel" NOT NULL DEFAULT 'UNKNOWN',
  "deep_static_score" INTEGER,
  "classification" "DeepStaticClassification",
  "classification_reasons" JSONB,
  "raw_evidence" JSONB,
  "inspected_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "repository_deep_static_inspections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deep_static_inspection_runs_inspection_version_key" ON "deep_static_inspection_runs"("inspection_version");
CREATE UNIQUE INDEX "repository_deep_static_inspections_repository_id_inspection_version_key" ON "repository_deep_static_inspections"("repository_id", "inspection_version");
CREATE INDEX "repository_deep_static_inspections_inspection_version_status_idx" ON "repository_deep_static_inspections"("inspection_version", "status");
CREATE INDEX "repository_deep_static_inspections_inspection_version_classification_deep_static_score_idx" ON "repository_deep_static_inspections"("inspection_version", "classification", "deep_static_score");
ALTER TABLE "repository_deep_static_inspections" ADD CONSTRAINT "repository_deep_static_inspections_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repository_deep_static_inspections" ADD CONSTRAINT "repository_deep_static_inspections_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "deep_static_inspection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
