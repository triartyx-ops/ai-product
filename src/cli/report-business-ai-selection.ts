import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import "dotenv/config";
import { AiAnalysisStatus, AiShortlistTier, BusinessAnalysisSource, BusinessProductCategory } from "@prisma/client";

import { categoryGroup, DEEP_TEST_TARGETS } from "@/lib/ai/deep-test-selection";
import { prisma } from "@/lib/db";

const { values } = parseArgs({ options: { output: { type: "string", default: "reports/business-ai-selection-v1.json" } }, strict: true });
const selectionVersion = "business-selection-v1";
const run = await prisma.businessAiSelectionRun.findUniqueOrThrow({ where: { selectionVersion } });
const analyses = await prisma.repositoryBusinessAiAnalysis.findMany({ where: { selectionVersion }, include: { repository: true } });
const completed = analyses.filter((item) => item.status === AiAnalysisStatus.COMPLETED);
const pool = await prisma.commercialCandidatePoolV3.findMany({
  orderBy: [{ bundleScore: "desc" }, { repository: { githubFullName: "asc" } }],
  include: { repository: true, businessAiAnalysis: true },
});
const shortlist = await prisma.deepTestShortlistV1.findMany({ orderBy: { rank: "asc" }, include: {
  repository: true, candidatePool: { include: { businessAiAnalysis: true } },
} });
const tiers = Object.fromEntries(Object.values(AiShortlistTier).map((tier) => [tier, completed.filter((item) => item.shortlistTier === tier).length]));
const perBusinessCategory = Object.fromEntries(Object.values(BusinessProductCategory).map((category) => [category, {
  analyzed: completed.filter((item) => item.productCategory === category).length,
  strong: completed.filter((item) => item.productCategory === category && item.shortlistTier === AiShortlistTier.STRONG).length,
  possible: completed.filter((item) => item.productCategory === category && item.shortlistTier === AiShortlistTier.POSSIBLE).length,
  selectedForDeepTest: shortlist.filter((item) => item.candidatePool.businessAiAnalysis?.selectionVersion === selectionVersion
    && item.candidatePool.businessAiAnalysis.productCategory === category).length,
}]));
const categoryDistributionV3 = Object.fromEntries([...new Set(pool.map((item) => item.category))].sort().map((category) => [category, {
  total: pool.filter((item) => item.category === category).length,
  strong: pool.filter((item) => item.category === category && item.shortlistTier === AiShortlistTier.STRONG).length,
  possible: pool.filter((item) => item.category === category && item.shortlistTier === AiShortlistTier.POSSIBLE).length,
  deepTest: shortlist.filter((item) => item.category === category).length,
}]));
const focusCategories: Record<string, string[]> = {
  CRM: ["CRM", "SALES", "LEAD_MANAGEMENT"], BOOKING: ["BOOKING", "APPOINTMENTS", "CALENDAR_BUSINESS"],
  HR: ["HR", "HRM", "ATS"], INVOICING: ["INVOICING"], ACCOUNTING: ["ACCOUNTING", "FINANCE", "EXPENSES"],
  ERP: ["ERP"], POS: ["POS"], INVENTORY: ["INVENTORY"], ECOMMERCE: ["ECOMMERCE"],
  CUSTOMER_SUPPORT: ["CUSTOMER_SUPPORT", "HELPDESK", "LIVE_CHAT"], PROJECT_MANAGEMENT: ["PROJECT_MANAGEMENT"],
  PROPERTY_MANAGEMENT: ["PROPERTY_MANAGEMENT", "REAL_ESTATE"], LMS: ["LMS", "COURSE_PLATFORM"],
  MARKETING: ["MARKETING", "EMAIL_MARKETING"], CMS: ["CMS"], ANALYTICS: ["ANALYTICS", "DASHBOARD"],
  AUTOMATION: ["AUTOMATION"], AI: ["AI_ASSISTANT", "AI_AGENT"], PRODUCTIVITY: ["PRODUCTIVITY", "FILE_MANAGEMENT"],
  CONTENT: ["CONTENT", "COMMUNICATION", "SOCIAL_MEDIA"], DEVELOPER_PRODUCT: ["DEVELOPER_PRODUCT"],
};
const focusDistribution = Object.fromEntries(Object.entries(focusCategories).map(([label, categories]) => [label, {
  poolV3: pool.filter((item) => categories.includes(item.category)).length,
  deepTest: shortlist.filter((item) => categories.includes(item.category)).length,
}]));
const topNewBusinessApplications = completed.filter((item) => item.source === BusinessAnalysisSource.NEW_AI)
  .sort((a, b) => (b.commercialBundleScore ?? -1) - (a.commercialBundleScore ?? -1)
    || (b.businessUsefulnessScore ?? -1) - (a.businessUsefulnessScore ?? -1)).slice(0, 100).map((item, index) => ({
    rank: index + 1, repository: item.repository.githubFullName ?? item.repository.repositoryUrl,
    category: item.productCategory, secondaryCategories: item.secondaryCategories, score: item.commercialBundleScore,
    tier: item.shortlistTier, description: item.shortProductDescription, whatUserGets: item.whatUserGets,
    buyerValueProposition: item.buyerValueProposition, clientProjectExamples: item.clientProjectExamples,
    license: item.repository.githubLicenseSpdx, stars: item.repository.githubStars, lastPush: item.repository.githubPushedAt,
  }));
const deepTestCandidates = shortlist.map((item) => ({
  rank: item.rank, repository: item.repository.githubFullName ?? item.repository.repositoryUrl, category: item.category,
  commercialBundleScore: item.bundleScore, selectionScore: item.selectionScore,
  license: item.repository.githubLicenseSpdx, stars: item.repository.githubStars, lastPush: item.repository.githubPushedAt,
  buyerValueProposition: item.candidatePool.buyerValueProposition ?? item.repository.githubDescription,
  reasonSelected: item.reasonSelected,
}));
const selectionEvidence = JSON.parse(await readFile(resolve("reports/deep-test-shortlist-v1-selection.json"), "utf8")) as {
  nearDuplicateProductsIntentionallyNotSelected: unknown[];
};
const poolGroupCounts = new Map<string, number>(); const shortlistGroupCounts = new Map<string, number>();
for (const item of pool) poolGroupCounts.set(categoryGroup(item.category), (poolGroupCounts.get(categoryGroup(item.category)) ?? 0) + 1);
for (const item of shortlist) shortlistGroupCounts.set(categoryGroup(item.category), (shortlistGroupCounts.get(categoryGroup(item.category)) ?? 0) + 1);
const weakCategories = Object.entries(DEEP_TEST_TARGETS).map(([group, target]) => ({ group, targetMinimum: target.minimum,
  acceptedAvailable: poolGroupCounts.get(group) ?? 0, selected: shortlistGroupCounts.get(group) ?? 0,
})).filter((item) => item.selected < item.targetMinimum);
const acceptedBusinessCount = completed.filter((item) => item.shortlistTier === AiShortlistTier.STRONG || item.shortlistTier === AiShortlistTier.POSSIBLE).length;
const duplicatesRemoved = 203 + acceptedBusinessCount - pool.length;
const report = {
  generatedAt: new Date(), selectionVersion,
  aiPass: { repositoriesEligible: run.eligibleCount, reusedExistingAnalyses: run.reusedCount,
    newlyAnalyzed: run.analyzedCount, aiRequests: run.apiRequests, errors: run.errorCount, tiers },
  qualityAudit: { audited: completed.filter((item) => item.qualityAuditStatus !== null).length,
    passed: completed.filter((item) => item.qualityAuditStatus === "PASS").length,
    corrected: completed.filter((item) => item.qualityAuditStatus === "CORRECTED").length,
    correction: "Kiranism/cvtailor: HR -> ATS; score unchanged at 78/POSSIBLE." },
  perBusinessCategory, commercialCandidatePoolV3: { total: pool.length,
    strong: pool.filter((item) => item.shortlistTier === AiShortlistTier.STRONG).length,
    possible: pool.filter((item) => item.shortlistTier === AiShortlistTier.POSSIBLE).length,
    duplicatesRemoved, categoryDistribution: categoryDistributionV3, focusDistribution },
  top100NewBusinessApplications: topNewBusinessApplications,
  deepTestShortlistV1: { total: shortlist.length, categoryDistribution: focusDistribution,
    candidates: deepTestCandidates, nearDuplicateProductsIntentionallyNotSelected: selectionEvidence.nearDuplicateProductsIntentionallyNotSelected },
  weakCategories,
};
const outputPath = resolve(values.output); await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdownPath = outputPath.replace(/\.json$/i, ".md");
const cell = (value: unknown): string => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const categoryRows = Object.entries(perBusinessCategory).filter(([, value]) => value.analyzed > 0).map(([category, value]) =>
  `| ${category} | ${value.analyzed} | ${value.strong} | ${value.possible} | ${value.selectedForDeepTest} |`).join("\n");
const diversityRows = Object.entries(focusDistribution).map(([category, value]) =>
  `| ${category} | ${value.poolV3} | ${value.deepTest} |`).join("\n");
const weakRows = weakCategories.map((item) =>
  `| ${item.group} | ${item.targetMinimum} | ${item.acceptedAvailable} | ${item.selected} |`).join("\n");
const businessRows = topNewBusinessApplications.map((item) => `| ${item.rank} | ${cell(item.repository)} | ${item.category} | ${item.score} | ${item.tier} | ${cell(item.description)} |`).join("\n");
const shortlistRows = deepTestCandidates.map((item) => `| ${item.rank} | ${cell(item.repository)} | ${item.category} | ${item.commercialBundleScore} | ${cell(item.license)} | ${item.stars ?? "—"} | ${item.lastPush?.toISOString().slice(0, 10) ?? "—"} | ${cell(item.buyerValueProposition)} | ${cell(item.reasonSelected)} |`).join("\n");
const markdown = `# Business AI Selection V1\n\nGenerated: ${new Date().toISOString()}\n\nThis is a preliminary deep-test shortlist, not the final 100. No repository was cloned or executed.\n\n## Actual totals\n\n- Eligible: ${run.eligibleCount}\n- Reused analyses: ${run.reusedCount}\n- Newly analyzed: ${run.analyzedCount}\n- AI requests: ${run.apiRequests}\n- Errors: ${run.errorCount}\n- STRONG / POSSIBLE / WEAK / REJECT: ${tiers.STRONG} / ${tiers.POSSIBLE} / ${tiers.WEAK} / ${tiers.REJECT}\n- Commercial pool V3: ${pool.length}\n- Deep-test shortlist: ${shortlist.length}\n- Repository duplicates removed while merging: ${duplicatesRemoved}\n- Near-duplicate exclusions: ${selectionEvidence.nearDuplicateProductsIntentionallyNotSelected.length}\n\n## Business AI results by category\n\n| Category | Analyzed | STRONG | POSSIBLE | Selected for deep test |\n|---|---:|---:|---:|---:|\n${categoryRows}\n\n## V3 diversity\n\n| Category group | Pool V3 | Deep test |\n|---|---:|---:|\n${diversityRows}\n\n## Categories below the target floor\n\n| Category group | Target minimum | Accepted available | Selected |\n|---|---:|---:|---:|\n${weakRows}\n\n## Top 100 new business applications\n\n| Rank | Repository | Category | Score | Tier | Description |\n|---:|---|---|---:|---|---|\n${businessRows}\n\n## deep_test_shortlist_v1\n\n| Rank | Repository | Category | Score | License | Stars | Last push | Buyer value | Selection reason |\n|---:|---|---|---:|---|---:|---|---|---|\n${shortlistRows}\n`;
await writeFile(markdownPath, markdown, "utf8");
console.info(JSON.stringify({ outputPath, markdownPath, aiPass: report.aiPass, qualityAudit: report.qualityAudit,
  commercialCandidatePoolV3: { total: pool.length, strong: report.commercialCandidatePoolV3.strong,
    possible: report.commercialCandidatePoolV3.possible, duplicatesRemoved }, deepTestShortlist: shortlist.length,
  focusDistribution, weakCategories, nearDuplicateExclusions: selectionEvidence.nearDuplicateProductsIntentionallyNotSelected.length }, null, 2));
await prisma.$disconnect();
