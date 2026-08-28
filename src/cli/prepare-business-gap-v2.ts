import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import "dotenv/config";
import {
  AiAnalysisStatus, AiPoolSource, AiShortlistTier, LicenseCategory, ReadmeStatus, RepositoryKind,
} from "@prisma/client";
import { z } from "zod";

import { GAP_TARGETS, discoverBusinessApplication, type DiscoveryResult } from "@/lib/business-gap/discovery";
import { prisma } from "@/lib/db";

const positive = z.coerce.number().int().positive();
const { values } = parseArgs({ options: {
  version: { type: "string", default: "business-gap-selection-v2" },
  "discovery-version": { type: "string", default: "business-gap-discovery-v1" },
  "gap-limit": { type: "string", default: "200" },
  "false-negative-limit": { type: "string", default: "100" },
  model: { type: "string" },
}, strict: true });
const analysisVersion = values.version;
const discoveryVersion = values["discovery-version"];
const gapLimit = positive.max(200).parse(values["gap-limit"]);
const falseNegativeLimit = positive.max(100).parse(values["false-negative-limit"]);
const promptVersion = "commercial-bundle-business-gaps-v2";
const provider = process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "codex");
const model = values.model ?? (provider === "codex" ? process.env.AI_CODEX_MODEL ?? "codex-default" : process.env.OPENAI_MODEL ?? "gpt-5-mini");
const previousVersion = "product-selection-v1";
const allowedKinds = [RepositoryKind.APPLICATION, RepositoryKind.STARTER, RepositoryKind.BOILERPLATE, RepositoryKind.UNKNOWN];

const repositories = await prisma.repository.findMany({
  where: {
    licenseCategory: LicenseCategory.PERMISSIVE, readmeStatus: ReadmeStatus.FETCHED,
    githubArchived: false, githubDisabled: false, daysSinceLastPush: { lte: 365 }, repositoryKind: { in: allowedKinds },
  },
  include: { aiAnalyses: { where: { analysisVersion: previousVersion } } },
});
await prisma.businessGapDiscovery.updateMany({ where: { discoveryVersion }, data: { selected: false } });
const topics = (value: unknown): string[] => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
type RepositoryRow = typeof repositories[number];
type Discovered = { repository: RepositoryRow; result: DiscoveryResult };
const discovered: Discovered[] = [];

for (const repository of repositories) {
  const result = discoverBusinessApplication({
    name: repository.githubFullName ?? `${repository.githubOwner}/${repository.githubRepo}`,
    description: repository.githubDescription, topics: topics(repository.githubTopics), homepage: repository.githubHomepage,
    readme: repository.readmeText ?? "", kind: repository.repositoryKind,
  });
  if (!result) continue;
  discovered.push({ repository, result });
  await prisma.businessGapDiscovery.upsert({
    where: { repositoryId_discoveryVersion: { repositoryId: repository.id, discoveryVersion } },
    create: { repositoryId: repository.id, discoveryVersion, primaryCategory: result.primaryCategory,
      matchedCategories: result.matchedCategories, discoveryReasons: result.reasons,
      discoveryScore: result.discoveryScore, standaloneScore: result.standaloneScore },
    update: { primaryCategory: result.primaryCategory, matchedCategories: result.matchedCategories,
      discoveryReasons: result.reasons, discoveryScore: result.discoveryScore, standaloneScore: result.standaloneScore, selected: false },
  });
}

const alreadyGood = (item: Discovered): boolean => {
  const tier = item.repository.aiAnalyses[0]?.shortlistTier;
  return tier === AiShortlistTier.STRONG || tier === AiShortlistTier.POSSIBLE;
};
const eligibleGap = discovered.filter((item) => !alreadyGood(item)).sort((a, b) =>
  b.result.discoveryScore - a.result.discoveryScore || b.result.standaloneScore - a.result.standaloneScore || Number(a.repository.id - b.repository.id));
const selectedIds = new Set<bigint>();
const gapSelected: Discovered[] = [];
for (const target of GAP_TARGETS) {
  const choices = eligibleGap.filter((item) => !selectedIds.has(item.repository.id) && item.result.matchedCategories.some((category) => target.categories.includes(category)));
  for (const item of choices.slice(0, target.target)) { selectedIds.add(item.repository.id); gapSelected.push(item); }
}
for (const item of eligibleGap) {
  if (gapSelected.length >= gapLimit) break;
  if (!selectedIds.has(item.repository.id)) { selectedIds.add(item.repository.id); gapSelected.push(item); }
}
await prisma.businessGapDiscovery.updateMany({ where: { discoveryVersion, repositoryId: { in: gapSelected.map((item) => item.repository.id) } }, data: { selected: true } });

const previousAnalyses = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion: previousVersion, shortlistTier: { in: [AiShortlistTier.REJECT, AiShortlistTier.WEAK] } },
  include: { repository: true },
});
const standaloneEvidence = /self[ -]?hosted|docker[ -]?compose|screenshots?|live demo|web application|frontend.{0,40}backend|authentication|deploy/i;
const rankedFalseNegatives = previousAnalyses.map((analysis) => {
  const repository = analysis.repository;
  const reasons: string[] = [];
  let rank = 0;
  if (analysis.isCompleteApplication) { rank += 70; reasons.push("previous AI marked is_complete_application=true"); }
  if (repository.repositoryKind === RepositoryKind.APPLICATION) { rank += 35; reasons.push("deterministic kind APPLICATION"); }
  if ((repository.productLikenessScore ?? 0) >= 70) { rank += 25; reasons.push(`high deterministic product likeness ${repository.productLikenessScore}`); }
  if ((repository.templatePotentialScore ?? 0) >= 70) { rank += 20; reasons.push(`high deterministic template potential ${repository.templatePotentialScore}`); }
  if (repository.githubHomepage) { rank += 10; reasons.push("homepage/demo present"); }
  if (standaloneEvidence.test(repository.readmeText ?? "")) { rank += 15; reasons.push("README has standalone/UI/deployment evidence"); }
  const isOpenCut = (repository.githubFullName ?? "").toLowerCase() === "opencut-app/opencut";
  if (isOpenCut) { rank += 1000; reasons.push("mandatory OpenCut audit: previous score cited an in-progress rewrite and insufficient completeness evidence"); }
  return { analysis, repository, rank, reasons: reasons.length ? reasons : ["suspicious low-scoring product candidate"] };
}).sort((a, b) => b.rank - a.rank || Number(a.repository.id - b.repository.id));

const requiredCompleteRejects = rankedFalseNegatives.filter((item) => item.analysis.shortlistTier === AiShortlistTier.REJECT && item.analysis.isCompleteApplication);
const falseNegativeSelected: typeof rankedFalseNegatives = [];
const falseIds = new Set<bigint>();
for (const item of [...requiredCompleteRejects, ...rankedFalseNegatives]) {
  if (falseNegativeSelected.length >= falseNegativeLimit) break;
  if (!falseIds.has(item.repository.id)) { falseIds.add(item.repository.id); falseNegativeSelected.push(item); }
}

const gapById = new Map(gapSelected.map((item) => [item.repository.id, item]));
const falseById = new Map(falseNegativeSelected.map((item) => [item.repository.id, item]));
const unionIds = [...new Set([...gapSelected.map((item) => item.repository.id), ...falseNegativeSelected.map((item) => item.repository.id)])];
const unionRepositories = new Map(repositories.map((repository) => [repository.id, repository]));
const run = await prisma.aiAnalysisRun.upsert({ where: { analysisVersion }, create: {
  analysisVersion, promptVersion, model, poolSize: unionIds.length,
}, update: { promptVersion, model, poolSize: unionIds.length } });
await prisma.repositoryAiAnalysis.deleteMany({ where: { analysisVersion, repositoryId: { notIn: unionIds } } });

for (const [index, repositoryId] of unionIds.entries()) {
  const repository = unionRepositories.get(repositoryId);
  if (!repository) throw new Error(`Missing repository ${repositoryId}`);
  const previous = repository.aiAnalyses.find((analysis) => analysis.analysisVersion === previousVersion) ?? falseById.get(repositoryId)?.analysis;
  const gap = gapById.get(repositoryId);
  const falseNegative = falseById.get(repositoryId);
  const discoveryReason = gap ? gap.result.reasons.join("; ") : null;
  const reevaluationReason = falseNegative ? falseNegative.reasons.join("; ") : null;
  const fingerprint = createHash("sha256").update(JSON.stringify({ promptVersion, repositoryId: repositoryId.toString(),
    readmeSha: repository.readmeSha, metadataUpdatedAt: repository.githubMetadataUpdatedAt?.toISOString(), discoveryReason, reevaluationReason,
    previousScore: previous?.commercialBundleScore ?? null })).digest("hex");
  const existing = await prisma.repositoryAiAnalysis.findUnique({ where: { repositoryId_analysisVersion: { repositoryId, analysisVersion } } });
  const source = falseNegative ? AiPoolSource.FALSE_NEGATIVE : AiPoolSource.GAP_FILL;
  const base = { runId: run.id, promptVersion, model, poolRank: index + 1, poolSource: source, inputFingerprint: fingerprint,
    previousStageStatus: previous?.shortlistTier ?? null, previousScore: previous?.commercialBundleScore ?? null,
    reevaluationReason, discoveryReason };
  await prisma.repositoryAiAnalysis.upsert({ where: { repositoryId_analysisVersion: { repositoryId, analysisVersion } },
    create: { repositoryId, analysisVersion, ...base }, update: { ...base,
      ...(existing && existing.inputFingerprint !== fingerprint ? { status: AiAnalysisStatus.PENDING, errorCode: null, errorMessage: null } : {}) },
  });
}

const categoryCounts = new Map<string, number>();
for (const item of gapSelected) for (const target of GAP_TARGETS) {
  if (item.result.matchedCategories.some((category) => target.categories.includes(category))) {
    const key = target.categories.join("/"); categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1); break;
  }
}
console.info(JSON.stringify({ eligibleRepositories: repositories.length, discoveredMatches: discovered.length,
  gapFillCandidates: gapSelected.length, falseNegativeCandidates: falseNegativeSelected.length,
  secondPassPool: unionIds.length, overlap: gapSelected.length + falseNegativeSelected.length - unionIds.length,
  requiredCompleteRejects: requiredCompleteRejects.length, categoryTargets: Object.fromEntries(categoryCounts),
}, null, 2));
await prisma.$disconnect();
