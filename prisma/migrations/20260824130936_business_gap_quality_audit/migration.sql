-- AlterTable
ALTER TABLE "repository_ai_analyses" ADD COLUMN     "quality_audit_notes" TEXT,
ADD COLUMN     "quality_audit_status" TEXT,
ADD COLUMN     "quality_audited_at" TIMESTAMPTZ(3);
