import { parseArgs } from "node:util";

import "dotenv/config";
import { AiAnalysisStatus, BusinessAnalysisSource, GitHubEnrichmentStatus, LicenseCategory, ReadmeStatus, RepositoryKind } from "@prisma/client";

import { businessSelectionFingerprint, type BusinessSelectionInput } from "@/lib/ai/business-selection";
import { reuseExistingAnalysis } from "@/lib/ai/business-selection-reuse";
import { shortlistTier } from "@/lib/ai/product-analysis";
import { prisma } from "@/lib/db";

const { values } = parseArgs({ options: { version: { type: "string", default: "business-selection-v1" }, model: { type: "string" } }, strict: true });
const selectionVersion = values.version;
const promptVersion = "business-commercial-selection-v1";
const provider = process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "codex");
const model = values.model ?? (provider === "codex" ? process.env.AI_CODEX_MODEL ?? "codex-default" : process.env.OPENAI_MODEL ?? "gpt-5-mini");
const allowedKinds = [RepositoryKind.APPLICATION, RepositoryKind.STARTER, RepositoryKind.BOILERPLATE, RepositoryKind.UNKNOWN];
const repositories = await prisma.repository.findMany({ where: {
  licenseCategory: LicenseCategory.PERMISSIVE, githubEnrichmentStatus: GitHubEnrichmentStatus.ENRICHED,
  githubArchived: false, githubDisabled: false, githubFork: false, daysSinceLastPush: { lte: 365 },
  readmeStatus: ReadmeStatus.FETCHED, repositoryKind: { in: allowedKinds }, githubSearchDiscoveries: { some: {} },
}, include: {
  githubSearchDiscoveries: { select: { targetBusinessCategory: true, searchQuery: true } },
  discoveries: { select: { id: true }, take: 1 },
  aiAnalyses: { where: { status: AiAnalysisStatus.COMPLETED }, orderBy: [{ qualityAuditedAt: "desc" }, { analyzedAt: "desc" }] },
} });
const run = await prisma.businessAiSelectionRun.upsert({ where: { selectionVersion }, create: {
  selectionVersion, promptVersion, model, eligibleCount: repositories.length,
}, update: { promptVersion, model, eligibleCount: repositories.length } });
const topics = (value: unknown): string[] => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
const makeInput = (repository: typeof repositories[number]): BusinessSelectionInput => ({
  fullName: repository.githubFullName ?? repository.repositoryUrl.replace("https://github.com/", ""),
  description: repository.githubDescription, topics: topics(repository.githubTopics), homepage: repository.githubHomepage,
  stars: repository.githubStars, primaryLanguage: repository.githubPrimaryLanguage, license: repository.githubLicenseSpdx,
  pushedAt: repository.githubPushedAt, readme: repository.readmeText ?? "", repositoryKind: repository.repositoryKind,
  productLikenessScore: repository.productLikenessScore, templatePotentialScore: repository.templatePotentialScore,
  targetBusinessCategories: [...new Set(repository.githubSearchDiscoveries.map((item) => item.targetBusinessCategory))],
  searchQueries: [...new Set(repository.githubSearchDiscoveries.map((item) => item.searchQuery))],
  existingAiAnalysis: repository.aiAnalyses[0] ? {
    version: repository.aiAnalyses[0].analysisVersion, category: repository.aiAnalyses[0].productCategory,
    score: repository.aiAnalyses[0].commercialBundleScore, tier: repository.aiAnalyses[0].shortlistTier,
    description: repository.aiAnalyses[0].shortProductDescription, reasons: repository.aiAnalyses[0].bundleScoreReasons,
  } : null,
});
let reused = 0;
for (const [index, repository] of repositories.entries()) {
  const input = makeInput(repository);
  const fingerprint = businessSelectionFingerprint(input, promptVersion);
  const existingBusiness = await prisma.repositoryBusinessAiAnalysis.findUnique({ where: { repositoryId_selectionVersion: { repositoryId: repository.id, selectionVersion } } });
  const reusable = repository.discoveries.length > 0 ? repository.aiAnalyses[0] : undefined;
  const source = reusable ? BusinessAnalysisSource.REUSED_EXISTING : BusinessAnalysisSource.NEW_AI;
  const base = { runId: run.id, promptVersion, model, source, inputFingerprint: fingerprint,
    reusedFromAiAnalysisId: reusable?.id ?? null, targetBusinessCategories: input.targetBusinessCategories, searchQueries: input.searchQueries };
  const record = await prisma.repositoryBusinessAiAnalysis.upsert({ where: { repositoryId_selectionVersion: { repositoryId: repository.id, selectionVersion } },
    create: { repositoryId: repository.id, selectionVersion, ...base }, update: { ...base,
      ...(existingBusiness && existingBusiness.inputFingerprint !== fingerprint ? { status: AiAnalysisStatus.PENDING, errorCode: null, errorMessage: null } : {}) },
  });
  if (reusable && record.status !== AiAnalysisStatus.COMPLETED) {
    const mapped = reuseExistingAnalysis(reusable, Boolean(repository.githubHomepage) || /screenshots?|!\[[^\]]*\]\([^)]*\)/iu.test(repository.readmeText ?? ""), input.fullName);
    await prisma.repositoryBusinessAiAnalysis.update({ where: { id: record.id }, data: { ...mapped,
      shortlistTier: shortlistTier(mapped.commercialBundleScore), status: AiAnalysisStatus.COMPLETED,
      analyzedAt: new Date(), rawResponse: { reusedFromAnalysisId: reusable.id.toString(), mapped },
    } });
    reused += 1;
  } else if (reusable) reused += 1;
  if ((index + 1) % 100 === 0) console.info(`Prepared ${index + 1}/${repositories.length}`);
}
await prisma.businessAiSelectionRun.update({ where: { id: run.id }, data: { reusedCount: reused } });
console.info(JSON.stringify({ selectionVersion, eligible: repositories.length, reusedExisting: reused, requiresNewAi: repositories.length - reused }, null, 2));
await prisma.$disconnect();
