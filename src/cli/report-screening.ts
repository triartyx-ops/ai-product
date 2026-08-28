import "dotenv/config";

import { CandidateStatus, GitHubEnrichmentStatus, LicenseCategory, ReadmeStatus, RepositoryKind } from "@prisma/client";

import { prisma } from "@/lib/db";

const enumCounts = async <T extends LicenseCategory | CandidateStatus | ReadmeStatus | RepositoryKind>(field: "licenseCategory" | "candidateStatus" | "readmeStatus" | "repositoryKind", values: readonly T[]) =>
  Object.fromEntries(await Promise.all(values.map(async (value) => [value.toLowerCase(), await prisma.repository.count({ where: { [field]: value } })])));

const license = await enumCounts("licenseCategory", Object.values(LicenseCategory));
const statuses = await enumCounts("candidateStatus", Object.values(CandidateStatus));
const readmes = await enumCounts("readmeStatus", Object.values(ReadmeStatus));
const kinds = await enumCounts("repositoryKind", Object.values(RepositoryKind));
const activePool = await prisma.repository.count({
  where: {
    githubEnrichmentStatus: GitHubEnrichmentStatus.ENRICHED,
    githubArchived: false,
    githubDisabled: false,
    licenseCategory: LicenseCategory.PERMISSIVE,
    daysSinceLastPush: { lte: 365 },
  },
});
const scoreBands = async (field: "productLikenessScore" | "templatePotentialScore") => ({
  "90-100": await prisma.repository.count({ where: { [field]: { gte: 90, lte: 100 } } }),
  "80-89": await prisma.repository.count({ where: { [field]: { gte: 80, lte: 89 } } }),
  "70-79": await prisma.repository.count({ where: { [field]: { gte: 70, lte: 79 } } }),
  "50-69": await prisma.repository.count({ where: { [field]: { gte: 50, lte: 69 } } }),
  "below-50": await prisma.repository.count({ where: { [field]: { lt: 50 } } }),
});
const top = await prisma.repository.findMany({
  where: { candidateStatus: CandidateStatus.CANDIDATE },
  orderBy: [{ templatePotentialScore: "desc" }, { productLikenessScore: "desc" }, { githubStars: "desc" }],
  take: 100,
  select: { githubFullName: true, repositoryUrl: true, githubDescription: true, githubLicenseSpdx: true, githubStars: true, githubPushedAt: true, repositoryKind: true, productLikenessScore: true, templatePotentialScore: true, githubHomepage: true },
});
const nonApplications = await prisma.repository.findMany({
  where: { repositoryKind: { not: RepositoryKind.APPLICATION }, githubStars: { not: null } },
  orderBy: { githubStars: "desc" },
  take: 30,
  select: { githubFullName: true, repositoryUrl: true, githubStars: true, repositoryKind: true, candidateStatus: true, githubDescription: true },
});

console.info(JSON.stringify({
  repositoriesTotal: await prisma.repository.count(),
  license,
  metadataGate: { v1CandidatePool: activePool, ...statuses },
  readme: { requested: readmes.fetched + readmes.missing + readmes.failed, ...readmes },
  repositoryKinds: kinds,
  productLikeness: await scoreBands("productLikenessScore"),
  templatePotential: await scoreBands("templatePotentialScore"),
  top100: top.map((repository, index) => ({ rank: index + 1, ...repository })),
  highestStarNonApplications: nonApplications,
}, null, 2));
await prisma.$disconnect();
