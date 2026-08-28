import "dotenv/config";

import { prisma } from "@/lib/db";
import { classifyGitHubLink } from "@/lib/repositories/extractor";

interface Occurrence {
  rawUrl: string;
  telegramMessageId: bigint;
  seenAt: Date;
}

interface RepositoryAggregate {
  owner: string;
  repo: string;
  occurrences: Occurrence[];
}

interface ExtractionStats {
  totalMessages: number;
  totalGitHubLinks: number;
  validRepositoryLinks: number;
  validRepositoryOccurrences: number;
  invalidGitHubLinks: number;
  issues: number;
  tree: number;
  blob: number;
  releases: number;
  dotGit: number;
  otherPaths: number;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function randomSample<T>(values: readonly T[], size: number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[randomIndex]!;
    shuffled[randomIndex] = current!;
  }
  return shuffled.slice(0, Math.min(size, shuffled.length));
}

const messages = await prisma.telegramMessage.findMany({
  orderBy: { id: "asc" },
  select: {
    telegramMessageId: true,
    publishedAt: true,
    externalLinks: true,
  },
});

const stats: ExtractionStats = {
  totalMessages: messages.length,
  totalGitHubLinks: 0,
  validRepositoryLinks: 0,
  validRepositoryOccurrences: 0,
  invalidGitHubLinks: 0,
  issues: 0,
  tree: 0,
  blob: 0,
  releases: 0,
  dotGit: 0,
  otherPaths: 0,
};
const repositories = new Map<string, RepositoryAggregate>();
const validRawLinks: Array<{ rawUrl: string; owner: string; repo: string; canonicalUrl: string }> = [];
const source = "telegram:GitHubRadar";

for (const message of messages) {
  const seenAt = message.publishedAt ?? new Date(0);
  const uniqueRepositoriesInMessage = new Set<string>();

  for (const rawUrl of asStringArray(message.externalLinks)) {
    const classification = classifyGitHubLink(rawUrl);
    if (!classification) continue;

    stats.totalGitHubLinks += 1;
    if (classification.hasDotGit) stats.dotGit += 1;
    if (!classification.repository) {
      stats.invalidGitHubLinks += 1;
      continue;
    }

    stats.validRepositoryLinks += 1;
    if (classification.pathKind === "issues") stats.issues += 1;
    if (classification.pathKind === "tree") stats.tree += 1;
    if (classification.pathKind === "blob") stats.blob += 1;
    if (classification.pathKind === "releases") stats.releases += 1;
    if (classification.pathKind === "other") stats.otherPaths += 1;

    const { canonicalUrl, owner, repo } = classification.repository;
    validRawLinks.push({ rawUrl, canonicalUrl, owner, repo });
    if (uniqueRepositoriesInMessage.has(canonicalUrl)) continue;
    uniqueRepositoriesInMessage.add(canonicalUrl);

    const aggregate = repositories.get(canonicalUrl) ?? { owner, repo, occurrences: [] };
    aggregate.occurrences.push({ rawUrl, telegramMessageId: message.telegramMessageId, seenAt });
    repositories.set(canonicalUrl, aggregate);
  }
}

for (const [repositoryUrl, aggregate] of repositories) {
  const repository = await prisma.repository.upsert({
    where: { repositoryUrl },
    create: {
      repositoryUrl,
      githubOwner: aggregate.owner,
      githubRepo: aggregate.repo,
      occurrencesCount: aggregate.occurrences.length,
    },
    update: {
      githubOwner: aggregate.owner,
      githubRepo: aggregate.repo,
      occurrencesCount: aggregate.occurrences.length,
    },
    select: { id: true },
  });

  for (const occurrence of aggregate.occurrences) {
    await prisma.repositoryDiscovery.upsert({
      where: {
        repositoryUrl_telegramMessageId_source: {
          repositoryUrl,
          telegramMessageId: occurrence.telegramMessageId,
          source,
        },
      },
      create: {
        repositoryId: repository.id,
        repositoryUrl,
        githubOwner: aggregate.owner,
        githubRepo: aggregate.repo,
        telegramMessageId: occurrence.telegramMessageId,
        source,
        firstSeenAt: occurrence.seenAt,
        lastSeenAt: occurrence.seenAt,
      },
      update: {
        repositoryId: repository.id,
        githubOwner: aggregate.owner,
        githubRepo: aggregate.repo,
        firstSeenAt: occurrence.seenAt,
        lastSeenAt: occurrence.seenAt,
      },
    });
  }
}

stats.validRepositoryOccurrences = [...repositories.values()].reduce(
  (count, repository) => count + repository.occurrences.length,
  0,
);

const audit = randomSample(validRawLinks, 100);
const invalidAuditRows = audit.filter(({ rawUrl, canonicalUrl, owner, repo }) =>
  canonicalUrl !== `https://github.com/${owner}/${repo}` || !rawUrl,
);
const examples = randomSample(validRawLinks, 20);
const topRepositories = await prisma.repository.findMany({
  orderBy: [{ occurrencesCount: "desc" }, { repositoryUrl: "asc" }],
  take: 20,
  select: { repositoryUrl: true, occurrencesCount: true },
});

console.info(JSON.stringify({
  ...stats,
  uniqueRepositories: repositories.size,
  duplicateOccurrences: stats.validRepositoryOccurrences - repositories.size,
  repositoriesWithMultipleOccurrences: [...repositories.values()].filter((repository) => repository.occurrences.length > 1).length,
  audit: {
    sampleSize: audit.length,
    invalidOwnerRepoMappings: invalidAuditRows.length,
    passed: invalidAuditRows.length === 0,
  },
  examples,
  topRepositories,
}, null, 2));

await prisma.$disconnect();
