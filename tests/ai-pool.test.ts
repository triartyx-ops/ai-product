import { CandidateStatus, RepositoryKind } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isEligibleReview, rankReviewPool, type PoolRepository } from "@/lib/ai/pool";

const repository = (id: number, kind: RepositoryKind, product = 40, template = 50): PoolRepository => ({
  id: BigInt(id), candidateStatus: CandidateStatus.REVIEW, repositoryKind: kind,
  productLikenessScore: product, templatePotentialScore: template, readmeText: "A self-hosted ready to use web app with a dashboard.",
});
describe("AI pool selection", () => {
  it("rejects irrelevant review kinds", () => expect(isEligibleReview(repository(1, RepositoryKind.AWESOME_LIST))).toBe(false));
  it("prioritizes applications without using stars", () => {
    const ranked = rankReviewPool([repository(1, RepositoryKind.CLI_TOOL, 90, 90), repository(2, RepositoryKind.APPLICATION, 30, 40)]);
    expect(ranked.map((item) => item.repositoryKind)).toEqual([RepositoryKind.APPLICATION, RepositoryKind.CLI_TOOL]);
  });
  it("allows only exceptional product-like libraries", () => {
    expect(isEligibleReview(repository(1, RepositoryKind.LIBRARY, 60, 60))).toBe(true);
    expect(isEligibleReview(repository(2, RepositoryKind.LIBRARY, 40, 60))).toBe(false);
  });
});
