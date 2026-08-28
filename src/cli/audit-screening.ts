import "dotenv/config";

import { RepositoryKind, ReadmeStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

function sample<T>(items: T[], count: number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [items[index], items[next]] = [items[next]!, items[index]!];
  }
  return items.slice(0, count);
}

const select = {
  githubFullName: true, githubDescription: true, githubHomepage: true, githubStars: true, githubPushedAt: true,
  repositoryKind: true, candidateStatus: true, productLikenessScore: true, templatePotentialScore: true,
  productLikenessReasons: true, readmeText: true,
} as const;
const applications = await prisma.repository.findMany({
  where: { repositoryKind: RepositoryKind.APPLICATION, readmeStatus: ReadmeStatus.FETCHED }, select,
});
const nonApplications = await prisma.repository.findMany({
  where: { repositoryKind: { not: RepositoryKind.APPLICATION }, readmeStatus: ReadmeStatus.FETCHED }, select,
});
const redact = (repository: typeof applications[number]) => ({
  repository: repository.githubFullName,
  kind: repository.repositoryKind,
  status: repository.candidateStatus,
  productLikeness: repository.productLikenessScore,
  templatePotential: repository.templatePotentialScore,
  description: repository.githubDescription,
  reasons: repository.productLikenessReasons,
  readmeExcerpt: repository.readmeText?.replace(/\s+/gu, " ").slice(0, 220),
});
console.info(JSON.stringify({
  applicationSample: sample(applications, 30).map(redact),
  nonApplicationSample: sample(nonApplications, 20).map(redact),
}, null, 2));
await prisma.$disconnect();
