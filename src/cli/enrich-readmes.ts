import { parseArgs } from "node:util";

import "dotenv/config";
import { CandidateStatus, GitHubEnrichmentStatus, LicenseCategory, ReadmeStatus, RepositoryKind } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { GitHubApiError, GitHubClient, GitHubRateLimitError, type GitHubRateLimit } from "@/lib/github/client";

const positiveInteger = z.coerce.number().int().positive();
const nonNegativeInteger = z.coerce.number().int().nonnegative();
const envSchema = z.object({
  GITHUB_TOKEN: z.string().trim().min(1),
  GITHUB_CONCURRENCY: positiveInteger.max(5).default(3),
});
const { values } = parseArgs({
  options: {
    "missing-only": { type: "boolean", default: false },
    "stale-days": { type: "string", default: "7" },
    limit: { type: "string" },
    source: { type: "string" },
  },
  strict: true,
});
const environment = envSchema.parse(process.env);
const staleBefore = new Date(Date.now() - nonNegativeInteger.parse(values["stale-days"]) * 86_400_000);
const sourceScope = values.source === undefined ? {} : values.source === "github-search"
  ? { githubSearchDiscoveries: { some: {} } }
  : (() => { throw new Error(`Unsupported --source: ${values.source}`); })();
const githubSearchPrefilter = values.source === "github-search" ? {
  licenseCategory: LicenseCategory.PERMISSIVE,
  githubEnrichmentStatus: GitHubEnrichmentStatus.ENRICHED,
  githubArchived: false,
  githubDisabled: false,
  githubFork: false,
  daysSinceLastPush: { lte: 365 },
  repositoryKind: { in: [RepositoryKind.APPLICATION, RepositoryKind.STARTER, RepositoryKind.BOILERPLATE, RepositoryKind.UNKNOWN] },
} : {};
const eligibility = values["missing-only"]
  ? { ...(values.source === "github-search" ? {} : { candidateStatus: CandidateStatus.CANDIDATE }), readmeStatus: { in: [ReadmeStatus.PENDING, ReadmeStatus.FAILED] } }
  : {
      ...(values.source === "github-search" ? {} : { candidateStatus: CandidateStatus.CANDIDATE }),
      OR: [
        { readmeStatus: { in: [ReadmeStatus.PENDING, ReadmeStatus.FAILED] } },
        { readmeStatus: ReadmeStatus.FETCHED, readmeUpdatedAt: { lt: staleBefore } },
      ],
    };
const eligible = await prisma.repository.findMany({
  where: { AND: [eligibility, sourceScope, githubSearchPrefilter] },
  orderBy: { id: "asc" },
  ...(values.limit === undefined ? {} : { take: positiveInteger.parse(values.limit) }),
  select: { id: true, githubOwner: true, githubRepo: true, readmeStatus: true },
});
let requests = 0;
let latestRate: GitHubRateLimit = { limit: null, remaining: null, resetAt: null };
const client = new GitHubClient({
  token: environment.GITHUB_TOKEN,
  onRequest: (rate) => { requests += 1; latestRate = rate; },
});
const stats = { fetched: 0, missing: 0, failed: 0, rateLimited: 0 };
let cursor = 0;
let stop = false;

function decodedReadme(content: string, encoding: string): string {
  return encoding.toLowerCase() === "base64" ? Buffer.from(content.replace(/\s/gu, ""), "base64").toString("utf8") : content;
}

async function worker(): Promise<void> {
  while (!stop) {
    const repository = eligible[cursor++];
    if (!repository) return;
    const claim = await prisma.repository.updateMany({
      where: { id: repository.id, readmeStatus: repository.readmeStatus },
      data: { readmeStatus: ReadmeStatus.PENDING },
    });
    if (claim.count === 0) continue;
    try {
      const response = await client.getReadme(repository.githubOwner, repository.githubRepo);
      const raw = decodedReadme(response.content, response.encoding);
      await prisma.repository.update({
        where: { id: repository.id },
        data: { readmeRaw: raw, readmeText: raw.replace(/\r\n/gu, "\n"), readmeSha: response.sha, readmeUpdatedAt: new Date(), readmeStatus: ReadmeStatus.FETCHED },
      });
      stats.fetched += 1;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (error instanceof GitHubApiError && error.status === 404) {
        await prisma.repository.update({ where: { id: repository.id }, data: { readmeStatus: ReadmeStatus.MISSING, readmeUpdatedAt: new Date() } });
        stats.missing += 1;
      } else if (error instanceof GitHubRateLimitError) {
        await prisma.repository.update({ where: { id: repository.id }, data: { readmeStatus: ReadmeStatus.FAILED } });
        stats.rateLimited += 1;
        stop = true;
      } else {
        await prisma.repository.update({ where: { id: repository.id }, data: { readmeStatus: ReadmeStatus.FAILED } });
        stats.failed += 1;
      }
    }
  }
}

await Promise.all(Array.from({ length: Math.min(environment.GITHUB_CONCURRENCY, eligible.length) }, () => worker()));
console.info(JSON.stringify({ selected: eligible.length, ...stats, requestsUsed: requests, rateLimitRemaining: latestRate.remaining }, null, 2));
await prisma.$disconnect();
