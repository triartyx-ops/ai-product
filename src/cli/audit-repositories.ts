import "dotenv/config";

import { prisma } from "@/lib/db";
import { classifyGitHubLink } from "@/lib/repositories/extractor";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex]!, result[index]!];
  }
  return result;
}

const messages = await prisma.telegramMessage.findMany({
  select: { telegramMessageId: true, externalLinks: true },
});
const candidates = messages.flatMap((message) =>
  asStringArray(message.externalLinks).flatMap((rawUrl) => {
    const classification = classifyGitHubLink(rawUrl);
    return classification?.repository
      ? [{ telegramMessageId: message.telegramMessageId, rawUrl, repository: classification.repository }]
      : [];
  }),
);
const sample = shuffled(candidates).slice(0, 100);
const source = "telegram:GitHubRadar";
const rows = await Promise.all(sample.map(async (candidate) => {
  const discovery = await prisma.repositoryDiscovery.findUnique({
    where: {
      repositoryUrl_telegramMessageId_source: {
        repositoryUrl: candidate.repository.canonicalUrl,
        telegramMessageId: candidate.telegramMessageId,
        source,
      },
    },
    select: { githubOwner: true, githubRepo: true },
  });
  const persistedMatch = discovery?.githubOwner === candidate.repository.owner && discovery.githubRepo === candidate.repository.repo;
  return {
    telegramMessageId: candidate.telegramMessageId.toString(),
    rawUrl: candidate.rawUrl,
    owner: candidate.repository.owner,
    repo: candidate.repository.repo,
    canonicalUrl: candidate.repository.canonicalUrl,
    persistedMatch,
  };
}));
const failures = rows.filter((row) => !row.persistedMatch);

console.info(JSON.stringify({ sampleSize: rows.length, passed: failures.length === 0, failures, rows }, null, 2));
await prisma.$disconnect();
