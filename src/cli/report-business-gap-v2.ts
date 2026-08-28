import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import "dotenv/config";
import { AiAnalysisStatus, AiProductCategory, AiShortlistTier, LicenseCategory, ReadmeStatus, RepositoryKind } from "@prisma/client";

import { GAP_TARGETS } from "@/lib/business-gap/discovery";
import { prisma } from "@/lib/db";

const { values } = parseArgs({ options: { output: { type: "string", default: "reports/business-gap-selection-v2.json" } }, strict: true });
const previousVersion = "product-selection-v1";
const secondVersion = "business-gap-selection-v2";
const discoveryVersion = "business-gap-discovery-v1";
const acceptedTiers: AiShortlistTier[] = [AiShortlistTier.STRONG, AiShortlistTier.POSSIBLE];
const run = await prisma.aiAnalysisRun.findUniqueOrThrow({ where: { analysisVersion: secondVersion } });
const eligibleRepositories = await prisma.repository.count({ where: {
  licenseCategory: LicenseCategory.PERMISSIVE, readmeStatus: ReadmeStatus.FETCHED,
  githubArchived: false, githubDisabled: false, daysSinceLastPush: { lte: 365 },
  repositoryKind: { in: [RepositoryKind.APPLICATION, RepositoryKind.STARTER, RepositoryKind.BOILERPLATE, RepositoryKind.UNKNOWN] },
} });
const gapFillCandidates = await prisma.businessGapDiscovery.count({ where: { discoveryVersion, selected: true } });
const secondAnalyses = await prisma.repositoryAiAnalysis.findMany({ where: { analysisVersion: secondVersion }, include: { repository: true } });
const pool = await prisma.commercialCandidatePoolV2.findMany({
  orderBy: [{ bundleScore: "desc" }, { repository: { githubFullName: "asc" } }],
  include: { repository: true, analysis: true },
});
const countTiers = (valuesToCount: Array<{ shortlistTier: AiShortlistTier | null }>): Record<string, number> =>
  Object.fromEntries(Object.values(AiShortlistTier).map((tier) => [tier, valuesToCount.filter((item) => item.shortlistTier === tier).length]));
const categoryDistribution = Object.fromEntries(Object.values(AiProductCategory).map((category) => [category,
  { total: pool.filter((item) => item.productCategory === category).length,
    strong: pool.filter((item) => item.productCategory === category && item.shortlistTier === AiShortlistTier.STRONG).length,
    possible: pool.filter((item) => item.productCategory === category && item.shortlistTier === AiShortlistTier.POSSIBLE).length }]
));

const compareCategories = [
  AiProductCategory.CRM, AiProductCategory.BOOKING, AiProductCategory.HR, AiProductCategory.INVOICING,
  AiProductCategory.CUSTOMER_SUPPORT, AiProductCategory.MARKETING, AiProductCategory.ECOMMERCE, AiProductCategory.ERP,
  AiProductCategory.PROJECT_MANAGEMENT, AiProductCategory.PROPERTY_MANAGEMENT, AiProductCategory.LMS,
];
const before = await prisma.repositoryAiAnalysis.groupBy({ by: ["productCategory"], where: {
  analysisVersion: previousVersion, status: AiAnalysisStatus.COMPLETED, shortlistTier: { in: acceptedTiers },
}, _count: true });
const beforeMap = new Map(before.map((item) => [item.productCategory, item._count]));
const beforeAfter = Object.fromEntries(compareCategories.map((category) => [category, {
  before: beforeMap.get(category) ?? 0, after: pool.filter((item) => item.productCategory === category).length,
}]));
const top150 = pool.slice(0, 150).map((item, index) => ({
  rank: index + 1, repository: item.repository.githubFullName ?? item.repository.repositoryUrl,
  description: item.analysis.shortProductDescription, license: item.repository.githubLicenseSpdx,
  stars: item.repository.githubStars, lastPush: item.repository.githubPushedAt, repositoryKind: item.analysis.aiRepositoryKind,
  category: item.productCategory, commercialBundleScore: item.bundleScore, tier: item.shortlistTier,
  homepage: item.repository.githubHomepage, buyerValueProposition: item.analysis.buyerValueProposition,
  clientProjectExamples: item.analysis.clientProjectExamples, origin: item.origin,
}));
const businessCategories = new Set<AiProductCategory>([
  AiProductCategory.CRM, AiProductCategory.SALES, AiProductCategory.LEAD_MANAGEMENT, AiProductCategory.ERP,
  AiProductCategory.PROJECT_MANAGEMENT, AiProductCategory.BOOKING, AiProductCategory.APPOINTMENTS,
  AiProductCategory.CALENDAR_BUSINESS, AiProductCategory.ECOMMERCE, AiProductCategory.INVENTORY, AiProductCategory.POS,
  AiProductCategory.CMS, AiProductCategory.ANALYTICS, AiProductCategory.DASHBOARD, AiProductCategory.CUSTOMER_SUPPORT,
  AiProductCategory.HELPDESK, AiProductCategory.LIVE_CHAT, AiProductCategory.HR, AiProductCategory.HRM, AiProductCategory.ATS,
  AiProductCategory.FINANCE, AiProductCategory.INVOICING, AiProductCategory.ACCOUNTING, AiProductCategory.EXPENSES,
  AiProductCategory.PAYROLL, AiProductCategory.MARKETING, AiProductCategory.EMAIL_MARKETING,
  AiProductCategory.PROPERTY_MANAGEMENT, AiProductCategory.REAL_ESTATE, AiProductCategory.RESTAURANT,
  AiProductCategory.HOTEL, AiProductCategory.LMS, AiProductCategory.COURSE_PLATFORM, AiProductCategory.FORM_BUILDER,
  AiProductCategory.SURVEY, AiProductCategory.TIME_TRACKING, AiProductCategory.DOCUMENT_MANAGEMENT,
  AiProductCategory.CLIENT_PORTAL, AiProductCategory.SUBSCRIPTION_MANAGEMENT,
]);
const topBusinessApplications = top150.filter((item) => businessCategories.has(item.category)).slice(0, 30);
const topNewBusinessApplications = secondAnalyses.filter((item) => item.shortlistTier && acceptedTiers.includes(item.shortlistTier) && item.productCategory && businessCategories.has(item.productCategory))
  .sort((a, b) => (b.commercialBundleScore ?? 0) - (a.commercialBundleScore ?? 0)).slice(0, 30).map((item, index) => ({
    rank: index + 1, repository: item.repository.githubFullName, description: item.shortProductDescription,
    category: item.productCategory, score: item.commercialBundleScore, tier: item.shortlistTier,
    buyerValueProposition: item.buyerValueProposition, clientProjectExamples: item.clientProjectExamples,
    previousStatus: item.previousStageStatus, previousScore: item.previousScore, scoreDelta: item.scoreDelta,
  }));
const rescued = secondAnalyses.filter((item) => item.previousStageStatus && item.shortlistTier && acceptedTiers.includes(item.shortlistTier));
const notableFalseNegatives = secondAnalyses.filter((item) => item.previousStageStatus).sort((a, b) => (b.scoreDelta ?? -999) - (a.scoreDelta ?? -999)).slice(0, 30).map((item) => ({
  repository: item.repository.githubFullName, previousStatus: item.previousStageStatus, previousScore: item.previousScore,
  newTier: item.shortlistTier, newScore: item.commercialBundleScore, scoreDelta: item.scoreDelta,
  category: item.productCategory, qualityAuditStatus: item.qualityAuditStatus, reasons: item.bundleScoreReasons,
}));
const openCut = secondAnalyses.find((item) => item.repository.githubFullName?.toLowerCase() === "opencut-app/opencut");
const groupCoverage = GAP_TARGETS.map((target) => ({ categories: target.categories, target: target.target,
  actual: pool.filter((item) => target.categories.includes(item.productCategory)).length }));
const poorlyRepresented = groupCoverage.filter((item) => item.actual < Math.min(5, item.target));
const report = {
  generatedAt: new Date(),
  discovery: { eligibleRepositories, gapFillCandidates, targetCoverage: groupCoverage },
  secondPass: { sent: run.poolSize, completed: run.completedCount, errors: run.errorCount, modelRequests: run.apiRequests,
    tiers: countTiers(secondAnalyses), newStrong: secondAnalyses.filter((item) => item.shortlistTier === AiShortlistTier.STRONG).length,
    newPossible: secondAnalyses.filter((item) => item.shortlistTier === AiShortlistTier.POSSIBLE).length,
    rescued: rescued.length, newGapFillAccepted: secondAnalyses.filter((item) => item.previousStageStatus === null && item.shortlistTier && acceptedTiers.includes(item.shortlistTier)).length },
  qualityAudit: {
    passed: secondAnalyses.filter((item) => item.qualityAuditStatus === "PASS").length,
    corrected: secondAnalyses.filter((item) => item.qualityAuditStatus === "CORRECTED").length,
    auditedStrong: 6, auditedPossible: 20, auditedRescued: 20,
    note: "Only 6 V2 STRONG existed before corrections, so all 6 were audited; 20 was not available.",
  },
  commercialCandidatePoolV2: { total: pool.length, tiers: countTiers(pool), rescued: pool.filter((item) => item.rescued).length,
    newGapFill: pool.filter((item) => item.newGapFill).length, categoryDistribution },
  beforeAfter, top150, topBusinessApplications, topNewBusinessApplications, notableFalseNegatives,
  openCut: openCut ? { previousScore: openCut.previousScore, newScore: openCut.commercialBundleScore, tier: openCut.shortlistTier,
    explanation: openCut.bundleScoreReasons } : null,
  poorlyRepresented,
};
const outputPath = resolve(values.output);
await mkdir(dirname(outputPath), { recursive: true });
const replacer = (_key: string, value: unknown): unknown => typeof value === "bigint" ? value.toString() : value;
await writeFile(outputPath, `${JSON.stringify(report, replacer, 2)}\n`, "utf8");
const markdownPath = outputPath.replace(/\.json$/i, ".md");
const escapeCell = (value: unknown): string => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = top150.map((item) => `| ${item.rank} | ${escapeCell(item.repository)} | ${item.commercialBundleScore} | ${item.tier} | ${item.category} | ${item.repositoryKind} | ${escapeCell(item.description)} | ${escapeCell(item.buyerValueProposition)} |`).join("\n");
const markdown = `# Commercial Candidate Pool V2\n\nGenerated: ${new Date().toISOString()}\n\nTotal: ${pool.length}. This is not the final 100.\n\n## Top 150\n\n| Rank | Repository | Score | Tier | Category | Kind | Description | Buyer value |\n|---:|---|---:|---|---|---|---|---|\n${rows}\n`;
await writeFile(markdownPath, markdown, "utf8");
console.info(JSON.stringify({ outputPath, markdownPath, gapFillCandidates, secondPassSent: run.poolSize,
  secondPassTiers: countTiers(secondAnalyses), rescued: rescued.length, poolSize: pool.length,
  categoryDistribution, beforeAfter, poorlyRepresented,
}, replacer, 2));
await prisma.$disconnect();
