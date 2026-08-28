-- CreateTable
CREATE TABLE "github_search_discoveries" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "github_id" BIGINT NOT NULL,
    "target_business_category" "AiProductCategory" NOT NULL,
    "search_query" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'github_search',
    "raw_result" JSONB NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "github_search_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "github_search_discoveries_repository_id_idx" ON "github_search_discoveries"("repository_id");

-- CreateIndex
CREATE INDEX "github_search_discoveries_target_business_category_last_see_idx" ON "github_search_discoveries"("target_business_category", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "github_search_discoveries_github_id_target_business_categor_key" ON "github_search_discoveries"("github_id", "target_business_category", "search_query");

-- AddForeignKey
ALTER TABLE "github_search_discoveries" ADD CONSTRAINT "github_search_discoveries_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
