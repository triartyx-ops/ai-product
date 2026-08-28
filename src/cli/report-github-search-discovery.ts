import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import "dotenv/config";
import { AiProductCategory, GitHubEnrichmentStatus, LicenseCategory, ReadmeStatus, RepositoryKind } from "@prisma/client";

import { prisma } from "@/lib/db";

const { values } = parseArgs({ options: { output: { type: "string", default: "reports/github-search-discovery.json" } }, strict: true });
const discoveries = await prisma.gitHubSearchDiscovery.findMany({ include: { repository: { include: { discoveries: { select: { id: true }, take: 1 } } } } });
const queries = await prisma.gitHubSearchQuery.findMany({ orderBy: [{ targetBusinessCategory: "asc" }, { searchQuery: "asc" }] });
const distinctRepositories = new Map(discoveries.map((discovery) => [discovery.repositoryId, discovery.repository]));
const repositories = [...distinctRepositories.values()];
const permissibleKinds = new Set<RepositoryKind>([RepositoryKind.APPLICATION, RepositoryKind.STARTER, RepositoryKind.BOILERPLATE, RepositoryKind.UNKNOWN]);
const isPreliminary = (repository: typeof repositories[number]): boolean =>
  repository.licenseCategory === LicenseCategory.PERMISSIVE &&
  repository.githubEnrichmentStatus === GitHubEnrichmentStatus.ENRICHED &&
  repository.githubArchived === false && repository.githubDisabled === false && repository.githubFork === false &&
  repository.daysSinceLastPush !== null && repository.daysSinceLastPush <= 365 &&
  repository.readmeStatus === ReadmeStatus.FETCHED && permissibleKinds.has(repository.repositoryKind);
const byCategory = Object.values(AiProductCategory).filter((category) => discoveries.some((discovery) => discovery.targetBusinessCategory === category)).map((category) => {
  const matches = discoveries.filter((discovery) => discovery.targetBusinessCategory === category);
  const unique = new Map(matches.map((match) => [match.repositoryId, match.repository]));
  const preliminary = [...unique.values()].filter(isPreliminary).sort((a, b) =>
    (b.templatePotentialScore ?? 0) - (a.templatePotentialScore ?? 0) ||
    (b.productLikenessScore ?? 0) - (a.productLikenessScore ?? 0) ||
    (a.githubFullName ?? a.repositoryUrl).localeCompare(b.githubFullName ?? b.repositoryUrl));
  return {
    category, rawResults: matches.length, uniqueRepositories: unique.size, preliminaryCandidates: preliminary.length,
    top20: preliminary.slice(0, 20).map((repository, index) => ({
      rank: index + 1, repository: repository.githubFullName ?? repository.repositoryUrl, description: repository.githubDescription,
      license: repository.githubLicenseSpdx, stars: repository.githubStars, lastPush: repository.githubPushedAt,
      kind: repository.repositoryKind, productLikeness: repository.productLikenessScore,
      templatePotential: repository.templatePotentialScore, homepage: repository.githubHomepage,
    })),
  };
});
const enumCounts = (items: Array<Record<string, unknown>>, field: string): Record<string, number> =>
  Object.fromEntries(items.reduce((counts, item) => {
    const value = String(item[field]); counts.set(value, (counts.get(value) ?? 0) + 1); return counts;
  }, new Map<string, number>()));
const readmeRepositories = repositories.filter((repository) => repository.readmeStatus === ReadmeStatus.FETCHED);
const report = {
  generatedAt: new Date(),
  search: {
    queriesExecuted: queries.filter((query) => query.status === "COMPLETED").length,
    queriesTotal: queries.length,
    rawResults: discoveries.length,
    uniqueRepositories: repositories.length,
    duplicatesWithExistingGitHubRadar: repositories.filter((repository) => repository.discoveries.length > 0).length,
    genuinelyNewRepositories: repositories.filter((repository) => repository.discoveries.length === 0).length,
    queryStates: enumCounts(queries as unknown as Array<Record<string, unknown>>, "status"),
  },
  metadata: {
    licenses: enumCounts(repositories as unknown as Array<Record<string, unknown>>, "licenseCategory"),
    archived: repositories.filter((repository) => repository.githubArchived === true).length,
    active: repositories.filter((repository) => repository.daysSinceLastPush !== null && repository.daysSinceLastPush <= 365).length,
    readmeFetched: readmeRepositories.length,
    classificationsWithReadme: enumCounts(readmeRepositories as unknown as Array<Record<string, unknown>>, "repositoryKind"),
    preliminaryCandidates: repositories.filter(isPreliminary).length,
  },
  categories: byCategory,
};
const outputPath = resolve(values.output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdownPath = outputPath.replace(/\.json$/iu, ".md");
const categoryMarkdown = byCategory.map((category) => {
  const rows = category.top20.map((item) => `| ${item.rank} | ${item.repository} | ${item.templatePotential ?? "—"} | ${item.productLikeness ?? "—"} | ${item.kind} | ${item.license ?? "—"} |`).join("\n");
  return `## ${category.category}\n\nRaw: ${category.rawResults}; unique: ${category.uniqueRepositories}; preliminary: ${category.preliminaryCandidates}.\n\n| # | Repository | Template | Product | Kind | License |\n|---:|---|---:|---:|---|---|\n${rows || "| — | — | — | — | — | — |"}`;
}).join("\n\n");
await writeFile(markdownPath, `# GitHub Search Discovery\n\n${categoryMarkdown}\n`, "utf8");
console.info(JSON.stringify({ outputPath, markdownPath, search: report.search, metadata: report.metadata,
  categorySummary: byCategory.map(({ category, rawResults, uniqueRepositories, preliminaryCandidates }) => ({ category, rawResults, uniqueRepositories, preliminaryCandidates })),
}, null, 2));
await prisma.$disconnect();
