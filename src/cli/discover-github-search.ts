import { parseArgs } from "node:util";

import "dotenv/config";
import { GitHubSearchQueryStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { GitHubApiError, GitHubClient, GitHubRateLimitError, type GitHubRateLimit } from "@/lib/github/client";
import { BUSINESS_SEARCH_DEFINITIONS, githubSearchQuery } from "@/lib/github/search-discovery";

const positive = z.coerce.number().int().positive();
const env = z.object({ GITHUB_TOKEN: z.string().trim().min(1), GITHUB_CONCURRENCY: positive.max(5).default(3) }).parse(process.env);
const { values } = parseArgs({ options: {
  "per-page": { type: "string", default: "30" }, refresh: { type: "boolean", default: false },
  "max-queries": { type: "string" }, help: { type: "boolean", short: "h", default: false },
}, strict: true });
if (values.help) {
  console.info("Usage: npm run discover:github-search -- [--per-page 30] [--refresh] [--max-queries N]");
  process.exit(0);
}
const perPage = positive.max(100).parse(values["per-page"]);
const pushedAfter = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const definitions = BUSINESS_SEARCH_DEFINITIONS.flatMap((definition) => definition.terms.map((term) => ({
  category: definition.category, query: githubSearchQuery(term, pushedAfter),
})));
const configured = values["max-queries"] === undefined ? definitions : definitions.slice(0, positive.parse(values["max-queries"]));
let requests = 0;
let latestRate: GitHubRateLimit = { limit: null, remaining: null, resetAt: null };
const client = new GitHubClient({ token: env.GITHUB_TOKEN, onRequest: (rate) => { requests += 1; latestRate = rate; } });
const stats = { queriesExecuted: 0, queriesSkipped: 0, rawResults: 0, incompleteQueries: 0, errors: 0, rateLimited: 0 };
let stop = false;

for (const definition of configured) {
  if (stop) break;
  const existing = await prisma.gitHubSearchQuery.upsert({ where: { searchQuery: definition.query }, create: {
    targetBusinessCategory: definition.category, searchQuery: definition.query,
  }, update: { targetBusinessCategory: definition.category } });
  if (!values.refresh && existing.status === GitHubSearchQueryStatus.COMPLETED) { stats.queriesSkipped += 1; continue; }
  const claim = await prisma.gitHubSearchQuery.updateMany({ where: values.refresh ? { id: existing.id } : {
    id: existing.id, status: { not: GitHubSearchQueryStatus.PROCESSING },
  }, data: { status: GitHubSearchQueryStatus.PROCESSING, startedAt: new Date(), errorCode: null, errorMessage: null } });
  if (!claim.count) { stats.queriesSkipped += 1; continue; }
  try {
    const response = await client.searchRepositories(definition.query, 1, perPage);
    const now = new Date();
    for (const item of response.items) {
      const rawResult = JSON.parse(JSON.stringify(item)) as object;
      const githubId = BigInt(item.id);
      const existingRepository = await prisma.repository.findFirst({ where: { OR: [
        { githubOwner: item.owner.login, githubRepo: item.name }, { githubId },
      ] }, select: { id: true } });
      const repository = existingRepository ?? await prisma.repository.create({ data: {
        repositoryUrl: item.html_url, githubOwner: item.owner.login, githubRepo: item.name,
      }, select: { id: true } });
      await prisma.gitHubSearchDiscovery.upsert({ where: { githubId_targetBusinessCategory_searchQuery: {
        githubId, targetBusinessCategory: definition.category, searchQuery: definition.query,
      } }, create: {
        repositoryId: repository.id, githubId, targetBusinessCategory: definition.category, searchQuery: definition.query,
        rawResult, firstSeenAt: now, lastSeenAt: now,
      }, update: { repositoryId: repository.id, rawResult, lastSeenAt: now } });
    }
    await prisma.gitHubSearchQuery.update({ where: { id: existing.id }, data: {
      status: GitHubSearchQueryStatus.COMPLETED, totalCount: response.total_count, rawResults: response.items.length,
      pagesProcessed: 1, incompleteResults: response.incomplete_results, completedAt: new Date(),
    } });
    stats.queriesExecuted += 1; stats.rawResults += response.items.length;
    if (response.incomplete_results) stats.incompleteQueries += 1;
    if (stats.queriesExecuted % 10 === 0) console.info(`GitHub Search: queries=${stats.queriesExecuted}/${configured.length}; raw=${stats.rawResults}; requests=${requests}`);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const rateLimited = error instanceof GitHubRateLimitError;
    await prisma.gitHubSearchQuery.update({ where: { id: existing.id }, data: {
      status: rateLimited ? GitHubSearchQueryStatus.RATE_LIMITED : GitHubSearchQueryStatus.FAILED,
      errorCode: error instanceof GitHubApiError ? error.code : "unknown", errorMessage: error.message.slice(0, 2_000),
    } });
    stats.errors += 1;
    if (rateLimited) { stats.rateLimited += 1; stop = true; }
  }
}
console.info(JSON.stringify({ ...stats, configuredQueries: configured.length, requestsUsed: requests,
  rateLimitRemaining: latestRate.remaining, rateLimitResetAt: latestRate.resetAt?.toISOString() ?? null,
}, null, 2));
await prisma.$disconnect();
