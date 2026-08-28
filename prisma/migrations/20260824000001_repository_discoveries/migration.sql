CREATE TABLE "repositories" (
    "id" BIGSERIAL NOT NULL,
    "repository_url" TEXT NOT NULL,
    "github_owner" TEXT NOT NULL,
    "github_repo" TEXT NOT NULL,
    "occurrences_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "repository_discoveries" (
    "id" BIGSERIAL NOT NULL,
    "repository_id" BIGINT NOT NULL,
    "repository_url" TEXT NOT NULL,
    "github_owner" TEXT NOT NULL,
    "github_repo" TEXT NOT NULL,
    "telegram_message_id" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "repository_discoveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repositories_repository_url_key" ON "repositories"("repository_url");
CREATE UNIQUE INDEX "repositories_github_owner_github_repo_key" ON "repositories"("github_owner", "github_repo");
CREATE INDEX "repositories_occurrences_count_idx" ON "repositories"("occurrences_count");
CREATE UNIQUE INDEX "repository_discoveries_repository_url_telegram_message_id_source_key"
ON "repository_discoveries"("repository_url", "telegram_message_id", "source");
CREATE INDEX "repository_discoveries_repository_id_idx" ON "repository_discoveries"("repository_id");
CREATE INDEX "repository_discoveries_telegram_message_id_idx" ON "repository_discoveries"("telegram_message_id");

ALTER TABLE "repository_discoveries"
ADD CONSTRAINT "repository_discoveries_repository_id_fkey"
FOREIGN KEY ("repository_id") REFERENCES "repositories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
