import { parseArgs } from "node:util";

import "dotenv/config";
import { GitHubEnrichmentStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { GitHubApiError, GitHubClient, GitHubRateLimitError, type GitHubRateLimit } from "@/lib/github/client";
import { mapGitHubMetadata } from "@/lib/github/metadata";

const positiveInteger = z.coerce.number().int().positive();
const nonNegativeInteger = z.coerce.number().int().nonnegative();
const envSchema = z.object({
  GITHUB_TOKEN: z.string().trim().min(1, "GITHUB_TOKEN is required for authenticated enrichment."),
  GITHUB_CONCURRENCY: positiveInteger.max(10).default(3),
});

const { values } = parseArgs({
  options: {
    "missing-only": { type: "boolean", default: false },
    "stale-days": { type: "string", default: "7" },
    limit: { type: "string" },
    random: { type: "boolean", default: false },
    source: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.info(`Usage: npm run enrich:github -- [options]

Options:
  --missing-only       Request only repositories with no successful metadata
  --stale-days <days>  Refresh enriched metadata older than this threshold (default: 7)
  --limit <number>     Process at most this many repositories; use 20 for smoke tests
  --random             Randomize eligible repositories before applying --limit
  --source github-search  Restrict to repositories discovered through GitHub Search
  --help, -h           Show this help`);
  process.exit(0);
}

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  console.error(`GitHub enrichment cannot start: ${envResult.error.issues.map((issue) => issue.message).join(" ")}`);
  process.exit(1);
}
const env = envResult.data;
const staleDays = nonNegativeInteger.parse(values["stale-days"]);
const limit = values.limit === undefined ? undefined : positiveInteger.parse(values.limit);
const staleBefore = new Date(Date.now() - staleDays * 86_400_000);
const missingStatuses = [
  GitHubEnrichmentStatus.PENDING,
  GitHubEnrichmentStatus.PROCESSING,
  GitHubEnrichmentStatus.FAILED,
  GitHubEnrichmentStatus.RATE_LIMITED,
];
const eligibility = values["missing-only"]
  ? {
      githubMetadataUpdatedAt: null,
      githubEnrichmentStatus: { in: missingStatuses },
    }
  : {
      OR: [
        { githubEnrichmentStatus: { in: missingStatuses } },
        {
          githubEnrichmentStatus: GitHubEnrichmentStatus.ENRICHED,
          OR: [
            { githubMetadataUpdatedAt: null },
            { githubMetadataUpdatedAt: { lt: staleBefore } },
          ],
        },
      ],
    };
const sourceScope = values.source === undefined ? {} : values.source === "github-search"
  ? { githubSearchDiscoveries: { some: {} } }
  : (() => { throw new Error(`Unsupported --source: ${values.source}`); })();

const eligibleRepositories = await prisma.repository.findMany({
  where: { AND: [eligibility, sourceScope] },
  orderBy: { id: "asc" },
  select: {
    id: true,
    repositoryUrl: true,
    githubOwner: true,
    githubRepo: true,
    githubEnrichmentStatus: true,
  },
});
const repositories = values.random
  ? eligibleRepositories.sort(() => Math.random() - 0.5)
  : eligibleRepositories;
if (limit !== undefined) repositories.splice(limit);

let requestCount = 0;
let latestRateLimit: GitHubRateLimit = { limit: null, remaining: null, resetAt: null };
const client = new GitHubClient({
  token: env.GITHUB_TOKEN,
  onRequest: (rateLimit) => {
    requestCount += 1;
    if (rateLimit.remaining !== null || rateLimit.limit !== null || rateLimit.resetAt !== null) latestRateLimit = rateLimit;
  },
});
const runStats = { enriched: 0, unavailable: 0, failed: 0, rateLimited: 0, skipped: 0 };
let cursor = 0;
let stopRequested = false;
const startedAt = Date.now();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopRequested = true;
    console.info(`\n${signal} received; finishing in-flight requests before stopping.`);
  });
}

async function enrichOne(repository: (typeof repositories)[number]): Promise<void> {
  const claimed = await prisma.repository.updateMany({
    where: { id: repository.id, githubEnrichmentStatus: repository.githubEnrichmentStatus },
    data: { githubEnrichmentStatus: GitHubEnrichmentStatus.PROCESSING, githubErrorCode: null, githubErrorMessage: null },
  });
  if (claimed.count === 0) {
    runStats.skipped += 1;
    return;
  }

  try {
    const response = await client.getRepository(repository.githubOwner, repository.githubRepo);
    const metadata = mapGitHubMetadata(response);
    await prisma.repository.update({
      where: { id: repository.id },
      data: {
        ...metadata,
        githubEnrichmentStatus: GitHubEnrichmentStatus.ENRICHED,
        githubMetadataUpdatedAt: new Date(),
        githubErrorCode: null,
        githubErrorMessage: null,
      },
    });
    runStats.enriched += 1;
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (error instanceof GitHubApiError && error.status === 404) {
      await prisma.repository.update({
        where: { id: repository.id },
        data: {
          githubEnrichmentStatus: GitHubEnrichmentStatus.UNAVAILABLE,
          githubErrorCode: "404",
          githubErrorMessage: error.message,
        },
      });
      runStats.unavailable += 1;
      return;
    }

    if (error instanceof GitHubRateLimitError) {
      await prisma.repository.update({
        where: { id: repository.id },
        data: {
          githubEnrichmentStatus: GitHubEnrichmentStatus.RATE_LIMITED,
          githubErrorCode: error.code,
          githubErrorMessage: error.message,
        },
      });
      runStats.rateLimited += 1;
      stopRequested = true;
      return;
    }

    const apiError = error instanceof GitHubApiError ? error : null;
    await prisma.repository.update({
      where: { id: repository.id },
      data: {
        githubEnrichmentStatus: GitHubEnrichmentStatus.FAILED,
        githubErrorCode: apiError?.code ?? "unknown",
        githubErrorMessage: error.message.slice(0, 2_000),
      },
    });
    runStats.failed += 1;
  }
}

async function worker(): Promise<void> {
  while (!stopRequested) {
    const repository = repositories[cursor];
    cursor += 1;
    if (!repository) return;
    await enrichOne(repository);
    const completed = runStats.enriched + runStats.unavailable + runStats.failed + runStats.rateLimited + runStats.skipped;
    if (completed > 0 && completed % 25 === 0) console.info(`Processed ${completed}/${repositories.length}; requests=${requestCount}`);
  }
}

await Promise.all(Array.from({ length: Math.min(env.GITHUB_CONCURRENCY, repositories.length) }, () => worker()));
const groupedStatuses = await prisma.repository.groupBy({
  by: ["githubEnrichmentStatus"],
  _count: { _all: true },
});
const statusCounts = Object.fromEntries(groupedStatuses.map((entry) => [entry.githubEnrichmentStatus.toLowerCase(), entry._count._all]));

console.info(JSON.stringify({
  selected: repositories.length,
  ...runStats,
  statusCounts,
  requestsUsed: requestCount,
  rateLimitRemaining: latestRateLimit.remaining,
  rateLimitResetAt: latestRateLimit.resetAt?.toISOString() ?? null,
  elapsedSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(3)),
}, null, 2));

await prisma.$disconnect();
