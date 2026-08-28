import { parseArgs } from "node:util";

import "dotenv/config";
import { AiAnalysisStatus, BusinessAnalysisSource } from "@prisma/client";
import { z } from "zod";

import { BUSINESS_SELECTION_SYSTEM_PROMPT, businessSelectionPrompt, businessSelectionSchema, type BusinessSelectionAnalysis, type BusinessSelectionInput } from "@/lib/ai/business-selection";
import { CodexCliProductClient } from "@/lib/ai/codex-cli-client";
import { AiApiError, OpenAiProductClient } from "@/lib/ai/openai-client";
import { shortlistTier } from "@/lib/ai/product-analysis";
import { prisma } from "@/lib/db";

const positive = z.coerce.number().int().positive();
const { values } = parseArgs({ options: { version: { type: "string", default: "business-selection-v1" }, limit: { type: "string" }, model: { type: "string" } }, strict: true });
const selectionVersion = values.version;
const provider = process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "codex");
const model = values.model ?? (provider === "codex" ? process.env.AI_CODEX_MODEL ?? "codex-default" : process.env.OPENAI_MODEL ?? "gpt-5-mini");
const readmeMaxChars = positive.parse(process.env.AI_README_MAX_CHARS ?? "30000");
const concurrency = positive.max(4).parse(process.env.AI_CONCURRENCY ?? "2");
const batchSize = positive.max(12).parse(process.env.AI_BATCH_SIZE ?? "10");
if (provider !== "openai" && provider !== "codex") throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
const run = await prisma.businessAiSelectionRun.findUniqueOrThrow({ where: { selectionVersion } });
await prisma.repositoryBusinessAiAnalysis.updateMany({ where: { selectionVersion, status: AiAnalysisStatus.PROCESSING }, data: { status: AiAnalysisStatus.PENDING } });
const pending = await prisma.repositoryBusinessAiAnalysis.findMany({ where: {
  selectionVersion, source: BusinessAnalysisSource.NEW_AI, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] },
}, orderBy: { id: "asc" }, ...(values.limit ? { take: positive.parse(values.limit) } : {}), include: {
  repository: { include: {
    githubSearchDiscoveries: { select: { targetBusinessCategory: true, searchQuery: true } },
    aiAnalyses: { where: { status: AiAnalysisStatus.COMPLETED }, orderBy: [{ qualityAuditedAt: "desc" }, { analyzedAt: "desc" }], take: 1 },
  } },
} });
await prisma.businessAiSelectionRun.update({ where: { id: run.id }, data: { status: AiAnalysisStatus.PROCESSING, startedAt: run.startedAt ?? new Date() } });
const topics = (value: unknown): string[] => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
const makeInput = (item: typeof pending[number]): BusinessSelectionInput => ({
  fullName: item.repository.githubFullName ?? item.repository.repositoryUrl.replace("https://github.com/", ""),
  description: item.repository.githubDescription, topics: topics(item.repository.githubTopics), homepage: item.repository.githubHomepage,
  stars: item.repository.githubStars, primaryLanguage: item.repository.githubPrimaryLanguage, license: item.repository.githubLicenseSpdx,
  pushedAt: item.repository.githubPushedAt, readme: item.repository.readmeText ?? "", repositoryKind: item.repository.repositoryKind,
  productLikenessScore: item.repository.productLikenessScore, templatePotentialScore: item.repository.templatePotentialScore,
  targetBusinessCategories: [...new Set(item.repository.githubSearchDiscoveries.map((match) => match.targetBusinessCategory))],
  searchQueries: [...new Set(item.repository.githubSearchDiscoveries.map((match) => match.searchQuery))],
  existingAiAnalysis: item.repository.aiAnalyses[0] ? {
    version: item.repository.aiAnalyses[0].analysisVersion, category: item.repository.aiAnalyses[0].productCategory,
    score: item.repository.aiAnalyses[0].commercialBundleScore, tier: item.repository.aiAnalyses[0].shortlistTier,
    description: item.repository.aiAnalyses[0].shortProductDescription, reasons: item.repository.aiAnalyses[0].bundleScoreReasons,
  } : null,
});
const openAiClient = provider === "openai" ? new OpenAiProductClient({ apiKey: z.string().trim().min(1).parse(process.env.OPENAI_API_KEY), model }) : null;
const codexClient = provider === "codex" ? new CodexCliProductClient(model === "codex-default" ? undefined : model) : null;
let cursor = 0; let completed = 0; let errors = 0; let requests = 0; let inputTokens = 0; let outputTokens = 0;
async function saveCompleted(item: typeof pending[number], analysis: BusinessSelectionAnalysis, raw: unknown): Promise<void> {
  await prisma.repositoryBusinessAiAnalysis.update({ where: { id: item.id }, data: { ...analysis,
    shortlistTier: shortlistTier(analysis.commercialBundleScore), status: AiAnalysisStatus.COMPLETED,
    rawResponse: raw as object, analyzedAt: new Date(), errorCode: null, errorMessage: null,
  } }); completed += 1;
}
async function saveFailed(item: typeof pending[number], cause: unknown): Promise<void> {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  await prisma.repositoryBusinessAiAnalysis.update({ where: { id: item.id }, data: { status: AiAnalysisStatus.FAILED,
    errorCode: error instanceof AiApiError ? error.code : "analysis_error", errorMessage: error.message.slice(0, 2_000) } }); errors += 1;
}
async function worker(): Promise<void> {
  for (;;) {
    const item = pending[cursor++]; if (!item) return;
    const claim = await prisma.repositoryBusinessAiAnalysis.updateMany({ where: { id: item.id, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, data: { status: AiAnalysisStatus.PROCESSING } });
    if (!claim.count) continue;
    try {
      if (!openAiClient) throw new Error("OpenAI client is not configured");
      const result = await openAiClient.analyzeBusinessSelection(BUSINESS_SELECTION_SYSTEM_PROMPT, businessSelectionPrompt(makeInput(item), readmeMaxChars));
      requests += result.usage.requests; inputTokens += result.usage.inputTokens; outputTokens += result.usage.outputTokens;
      await saveCompleted(item, result.analysis, result.raw);
    } catch (cause) { await saveFailed(item, cause); }
    if ((completed + errors) % 10 === 0) console.info(`Business AI ${completed + errors}/${pending.length}; completed=${completed}; errors=${errors}`);
  }
}
async function batchWorker(): Promise<void> {
  for (;;) {
    const batch = pending.slice(cursor, cursor += batchSize); if (!batch.length) return;
    const active: typeof batch = [];
    for (const item of batch) {
      const claim = await prisma.repositoryBusinessAiAnalysis.updateMany({ where: { id: item.id, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, data: { status: AiAnalysisStatus.PROCESSING } });
      if (claim.count) active.push(item);
    }
    if (!active.length) continue;
    try {
      if (!codexClient) throw new Error("Codex client is not configured");
      const requested = active.map((item) => ({ repositoryFullName: makeInput(item).fullName, input: businessSelectionPrompt(makeInput(item), readmeMaxChars) }));
      const result = await codexClient.analyzeBusinessSelectionBatch(BUSINESS_SELECTION_SYSTEM_PROMPT, requested);
      requests += result.usage.requests;
      const byName = new Map(result.analyses.map((analysis) => [analysis.repositoryFullName.toLowerCase(), analysis]));
      for (const item of active) {
        const fullName = makeInput(item).fullName; const analysis = byName.get(fullName.toLowerCase());
        if (!analysis) { await saveFailed(item, new Error(`Batch response missing ${fullName}`)); continue; }
        await saveCompleted(item, businessSelectionSchema.parse(analysis), analysis);
      }
    } catch (cause) { for (const item of active) await saveFailed(item, cause); }
    console.info(`Business AI ${completed + errors}/${pending.length}; completed=${completed}; errors=${errors}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => provider === "codex" ? batchWorker() : worker()));
const totals = await prisma.repositoryBusinessAiAnalysis.groupBy({ by: ["status"], where: { selectionVersion }, _count: true });
const totalCompleted = totals.find((entry) => entry.status === AiAnalysisStatus.COMPLETED)?._count ?? 0;
const totalErrors = totals.find((entry) => entry.status === AiAnalysisStatus.FAILED)?._count ?? 0;
await prisma.businessAiSelectionRun.update({ where: { id: run.id }, data: {
  status: totalCompleted === run.eligibleCount ? AiAnalysisStatus.COMPLETED : AiAnalysisStatus.FAILED,
  analyzedCount: totalCompleted - run.reusedCount, errorCount: totalErrors, apiRequests: { increment: requests },
  inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens }, completedAt: totalCompleted === run.eligibleCount ? new Date() : null,
} });
const tiers = await prisma.repositoryBusinessAiAnalysis.groupBy({ by: ["shortlistTier"], where: { selectionVersion, status: AiAnalysisStatus.COMPLETED }, _count: true });
console.info(JSON.stringify({ selected: pending.length, completed, errors, requests, totalCompleted, totalErrors,
  tiers: Object.fromEntries(tiers.map((entry) => [entry.shortlistTier ?? "NONE", entry._count])) }, null, 2));
await prisma.$disconnect();
