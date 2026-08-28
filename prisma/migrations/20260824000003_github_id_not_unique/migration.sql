DROP INDEX "repositories_github_id_key";

CREATE INDEX "repositories_github_id_idx" ON "repositories"("github_id");
