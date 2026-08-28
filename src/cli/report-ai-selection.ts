import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AiAnalysisStatus, AiShortlistTier } from "@prisma/client";

import { prisma } from "@/lib/db";

const analysisVersion = process.argv.find((argument) => argument.startsWith("--version="))?.split("=")[1] ?? "product-selection-v1";
const outputPath = process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length);
const run = await prisma.aiAnalysisRun.findUniqueOrThrow({ where: { analysisVersion } });
const tierCounts = Object.fromEntries(await Promise.all(Object.values(AiShortlistTier).map(async (tier) => [tier, await prisma.repositoryAiAnalysis.count({ where: { analysisVersion, shortlistTier: tier } })])));
const categories = await prisma.repositoryAiAnalysis.groupBy({
  by: ["productCategory", "shortlistTier"], where: { analysisVersion, status: AiAnalysisStatus.COMPLETED }, _count: true,
});
const categoryDistribution = Object.fromEntries([...new Set(categories.map((entry) => entry.productCategory).filter((value): value is NonNullable<typeof value> => value !== null))].sort().map((category) => {
  const rows = categories.filter((entry) => entry.productCategory === category);
  const count = (tier: AiShortlistTier): number => rows.find((entry) => entry.shortlistTier === tier)?._count ?? 0;
  return [category, { strong: count(AiShortlistTier.STRONG), possible: count(AiShortlistTier.POSSIBLE), weak: count(AiShortlistTier.WEAK), reject: count(AiShortlistTier.REJECT), total: rows.reduce((sum, entry) => sum + entry._count, 0) }];
}));
const top100 = await prisma.repositoryAiAnalysis.findMany({ where: { analysisVersion, status: AiAnalysisStatus.COMPLETED },
  orderBy: [{ commercialBundleScore: "desc" }, { businessUsefulnessScore: "desc" }, { easeOfDeploymentScore: "desc" }], take: 100,
  select: { commercialBundleScore: true, shortlistTier: true, productCategory: true, actualProductName: true, shortProductDescription: true,
    bundleScoreReasons: true, repository: { select: { githubFullName: true, repositoryUrl: true, githubStars: true, githubLicenseSpdx: true } } },
});
const interesting = top100.slice(0, 30).map((entry, index) => ({ rank: index + 1, repository: entry.repository.githubFullName ?? entry.repository.repositoryUrl,
  score: entry.commercialBundleScore, category: entry.productCategory, userGets: entry.shortProductDescription, positioning: entry.bundleScoreReasons }));
const popularRejects = await prisma.repositoryAiAnalysis.findMany({ where: { analysisVersion, shortlistTier: AiShortlistTier.REJECT },
  orderBy: { repository: { githubStars: "desc" } }, take: 30,
  select: { commercialBundleScore: true, aiRepositoryKind: true, bundleScoreReasons: true,
    repository: { select: { githubFullName: true, repositoryUrl: true, githubStars: true, githubDescription: true } } },
});
const report = { analysisVersion, model: run.model, poolSize: run.poolSize, successfullyAnalyzed: run.completedCount,
  errors: run.errorCount, modelRequests: run.apiRequests, tokenUsageAvailable: run.model !== "codex-default",
  inputTokens: run.model === "codex-default" ? null : run.inputTokens, outputTokens: run.model === "codex-default" ? null : run.outputTokens,
  tiers: tierCounts, categoryDistribution,
  top100: top100.map((entry, index) => ({ rank: index + 1, ...entry })), top30Interesting: interesting, popularRejectedDespiteStars: popularRejects,
};
const serialized = JSON.stringify(report, null, 2);
console.info(serialized);
if (outputPath) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${serialized}\n`, "utf8");
  console.info(`Report written to ${absolutePath}`);
}
await prisma.$disconnect();
