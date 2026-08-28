import { parseArgs } from "node:util";

import "dotenv/config";
import { AiAnalysisStatus } from "@prisma/client";
import { z } from "zod";

import { BUSINESS_GAP_SYSTEM_PROMPT, businessGapAnalysisSchema, businessGapPrompt, type BusinessGapAnalysis } from "@/lib/ai/business-gap-analysis";
import { CodexCliProductClient } from "@/lib/ai/codex-cli-client";
import { AiApiError, OpenAiProductClient } from "@/lib/ai/openai-client";
import { shortlistTier, type AnalysisInput } from "@/lib/ai/product-analysis";
import { prisma } from "@/lib/db";

const positive = z.coerce.number().int().positive();
const { values } = parseArgs({ options: {
  version: { type: "string", default: "business-gap-selection-v2" }, model: { type: "string" }, limit: { type: "string" },
}, strict: true });
const analysisVersion = values.version;
const provider = process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "codex");
const model = values.model ?? (provider === "codex" ? process.env.AI_CODEX_MODEL ?? "codex-default" : process.env.OPENAI_MODEL ?? "gpt-5-mini");
const readmeMaxChars = positive.parse(process.env.AI_README_MAX_CHARS ?? "30000");
const concurrency = positive.max(4).parse(process.env.AI_CONCURRENCY ?? "2");
const batchSize = positive.max(12).parse(process.env.AI_BATCH_SIZE ?? "10");
if (provider !== "openai" && provider !== "codex") throw new Error(`Unsupported AI_PROVIDER: ${provider}`);

const run = await prisma.aiAnalysisRun.findUniqueOrThrow({ where: { analysisVersion } });
await prisma.repositoryAiAnalysis.updateMany({ where: { analysisVersion, status: AiAnalysisStatus.PROCESSING }, data: { status: AiAnalysisStatus.PENDING } });
const pending = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, orderBy: { poolRank: "asc" },
  ...(values.limit ? { take: positive.parse(values.limit) } : {}), include: { repository: true },
});
await prisma.aiAnalysisRun.update({ where: { id: run.id }, data: { status: AiAnalysisStatus.PROCESSING, startedAt: run.startedAt ?? new Date() } });
const topics = (value: unknown): string[] => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
const makeInput = (item: typeof pending[number]): AnalysisInput => ({
  fullName: item.repository.githubFullName ?? item.repository.repositoryUrl.replace("https://github.com/", ""),
  description: item.repository.githubDescription, topics: topics(item.repository.githubTopics), homepage: item.repository.githubHomepage,
  stars: item.repository.githubStars, primaryLanguage: item.repository.githubPrimaryLanguage, pushedAt: item.repository.githubPushedAt,
  license: item.repository.githubLicenseSpdx, readme: item.repository.readmeText ?? "", deterministicKind: item.repository.repositoryKind,
  productLikenessScore: item.repository.productLikenessScore, templatePotentialScore: item.repository.templatePotentialScore,
});
const contextFor = (item: typeof pending[number]) => ({
  previousStageStatus: item.previousStageStatus, previousScore: item.previousScore,
  reevaluationReason: item.reevaluationReason, discoveryReason: item.discoveryReason,
});
const openAiClient = provider === "openai" ? new OpenAiProductClient({
  apiKey: z.string().trim().min(1, "OPENAI_API_KEY is required for AI_PROVIDER=openai").parse(process.env.OPENAI_API_KEY), model,
}) : null;
const codexClient = provider === "codex" ? new CodexCliProductClient(model === "codex-default" ? undefined : model) : null;
let cursor = 0; let completed = 0; let errors = 0; let requests = 0; let inputTokens = 0; let outputTokens = 0;

async function saveCompleted(item: typeof pending[number], analysis: BusinessGapAnalysis, raw: unknown): Promise<void> {
  const scoreDelta = item.previousScore === null ? null : analysis.commercialBundleScore - item.previousScore;
  const scoreChanged = scoreDelta !== null && scoreDelta !== 0;
  await prisma.repositoryAiAnalysis.update({ where: { id: item.id }, data: {
    ...analysis, previousStageStatus: item.previousStageStatus, previousScore: item.previousScore,
    reevaluationReason: item.reevaluationReason, discoveryReason: item.discoveryReason, scoreDelta, scoreChanged,
    shortlistTier: shortlistTier(analysis.commercialBundleScore), rawResponse: raw as object,
    status: AiAnalysisStatus.COMPLETED, analyzedAt: new Date(), errorCode: null, errorMessage: null,
  } });
  completed += 1;
}
async function saveFailed(item: typeof pending[number], cause: unknown): Promise<void> {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  await prisma.repositoryAiAnalysis.update({ where: { id: item.id }, data: { status: AiAnalysisStatus.FAILED,
    errorCode: error instanceof AiApiError ? error.code : "analysis_error", errorMessage: error.message.slice(0, 2000) } });
  errors += 1;
}
async function worker(): Promise<void> {
  for (;;) {
    const item = pending[cursor++]; if (!item) return;
    const claim = await prisma.repositoryAiAnalysis.updateMany({ where: { id: item.id, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, data: { status: AiAnalysisStatus.PROCESSING } });
    if (!claim.count) continue;
    try {
      if (!openAiClient) throw new Error("OpenAI client is not configured");
      const result = await openAiClient.analyzeBusiness(BUSINESS_GAP_SYSTEM_PROMPT, businessGapPrompt(makeInput(item), contextFor(item), readmeMaxChars));
      requests += result.usage.requests; inputTokens += result.usage.inputTokens; outputTokens += result.usage.outputTokens;
      await saveCompleted(item, result.analysis, result.raw);
    } catch (cause) { await saveFailed(item, cause); }
    if ((completed + errors) % 10 === 0) console.info(`V2 AI progress ${completed + errors}/${pending.length}; completed=${completed}; errors=${errors}`);
  }
}
async function batchWorker(): Promise<void> {
  for (;;) {
    const batch = pending.slice(cursor, cursor += batchSize); if (!batch.length) return;
    const active: typeof batch = [];
    for (const item of batch) {
      const claim = await prisma.repositoryAiAnalysis.updateMany({ where: { id: item.id, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, data: { status: AiAnalysisStatus.PROCESSING } });
      if (claim.count) active.push(item);
    }
    if (!active.length) continue;
    try {
      if (!codexClient) throw new Error("Codex client is not configured");
      const requested = active.map((item) => ({ repositoryFullName: makeInput(item).fullName,
        input: businessGapPrompt(makeInput(item), contextFor(item), readmeMaxChars) }));
      const result = await codexClient.analyzeBusinessBatch(BUSINESS_GAP_SYSTEM_PROMPT, requested);
      requests += result.usage.requests;
      const byName = new Map(result.analyses.map((analysis) => [analysis.repositoryFullName.toLowerCase(), analysis]));
      for (const item of active) {
        const fullName = makeInput(item).fullName;
        const analysis = byName.get(fullName.toLowerCase());
        if (!analysis) { await saveFailed(item, new Error(`Batch response missing ${fullName}`)); continue; }
        await saveCompleted(item, businessGapAnalysisSchema.parse(analysis), analysis);
      }
    } catch (cause) { for (const item of active) await saveFailed(item, cause); }
    console.info(`V2 AI progress ${completed + errors}/${pending.length}; completed=${completed}; errors=${errors}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => provider === "codex" ? batchWorker() : worker()));
const totals = await prisma.repositoryAiAnalysis.groupBy({ by: ["status"], where: { analysisVersion }, _count: true });
const totalCompleted = totals.find((entry) => entry.status === AiAnalysisStatus.COMPLETED)?._count ?? 0;
const totalErrors = totals.find((entry) => entry.status === AiAnalysisStatus.FAILED)?._count ?? 0;
await prisma.aiAnalysisRun.update({ where: { id: run.id }, data: {
  status: totalCompleted === run.poolSize ? AiAnalysisStatus.COMPLETED : AiAnalysisStatus.FAILED,
  completedCount: totalCompleted, errorCount: totalErrors, apiRequests: { increment: requests },
  inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens },
  completedAt: totalCompleted === run.poolSize ? new Date() : null,
} });
const tiers = await prisma.repositoryAiAnalysis.groupBy({ by: ["shortlistTier"], where: { analysisVersion, status: AiAnalysisStatus.COMPLETED }, _count: true });
console.info(JSON.stringify({ selected: pending.length, completed, errors, requests, inputTokens, outputTokens,
  totalCompleted, totalErrors, tiers: Object.fromEntries(tiers.map((entry) => [entry.shortlistTier ?? "NONE", entry._count])),
}, null, 2));
await prisma.$disconnect();
