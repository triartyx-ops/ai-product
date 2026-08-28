import { CandidateStatus, RepositoryKind, type Repository } from "@prisma/client";

const EXCLUDED = new Set<RepositoryKind>([
  RepositoryKind.AWESOME_LIST, RepositoryKind.BOOK, RepositoryKind.COURSE, RepositoryKind.TUTORIAL,
  RepositoryKind.ALGORITHM_COLLECTION, RepositoryKind.RESOURCE_COLLECTION, RepositoryKind.CONFIG,
]);
const PRIORITY: Record<RepositoryKind, number> = {
  APPLICATION: 0, STARTER: 1, BOILERPLATE: 2, UNKNOWN: 3, DEV_TOOL: 4, CLI_TOOL: 5,
  LIBRARY: 6, FRAMEWORK: 6, AWESOME_LIST: 99, BOOK: 99, COURSE: 99, TUTORIAL: 99,
  ALGORITHM_COLLECTION: 99, RESOURCE_COLLECTION: 99, CONFIG: 99,
};

export type PoolRepository = Pick<Repository, "id" | "candidateStatus" | "repositoryKind" | "productLikenessScore" | "templatePotentialScore" | "readmeText">;

export function isEligibleReview(repository: PoolRepository): boolean {
  if (repository.candidateStatus !== CandidateStatus.REVIEW || EXCLUDED.has(repository.repositoryKind) || !repository.readmeText) return false;
  const product = repository.productLikenessScore ?? 0;
  const template = repository.templatePotentialScore ?? 0;
  if (repository.repositoryKind === RepositoryKind.LIBRARY || repository.repositoryKind === RepositoryKind.FRAMEWORK) {
    return product >= 55 && template >= 55 && /self-hosted|web app|desktop app|dashboard|complete product|ready to use/iu.test(repository.readmeText);
  }
  return product >= 25 || template >= 40 || [RepositoryKind.APPLICATION, RepositoryKind.STARTER, RepositoryKind.BOILERPLATE].includes(repository.repositoryKind as "APPLICATION" | "STARTER" | "BOILERPLATE");
}

export function rankReviewPool<T extends PoolRepository>(repositories: T[]): T[] {
  return repositories.filter(isEligibleReview).sort((left, right) => {
    const kind = PRIORITY[left.repositoryKind] - PRIORITY[right.repositoryKind];
    if (kind !== 0) return kind;
    const signalLeft = (left.templatePotentialScore ?? 0) * 2 + (left.productLikenessScore ?? 0);
    const signalRight = (right.templatePotentialScore ?? 0) * 2 + (right.productLikenessScore ?? 0);
    return signalRight - signalLeft || Number(left.id - right.id);
  });
}
