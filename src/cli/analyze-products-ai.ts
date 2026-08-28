import { parseArgs } from "node:util";

import "dotenv/config";
import { AiAnalysisStatus, AiPoolSource, CandidateStatus, LicenseCategory, ReadmeStatus } from "@prisma/client";
import { z } from "zod";

import { OpenAiProductClient, AiApiError } from "@/lib/ai/openai-client";
import { CodexCliProductClient } from "@/lib/ai/codex-cli-client";
import { aiProductAnalysisSchema, analysisPrompt, inputFingerprint, PRODUCT_ANALYSIS_SYSTEM_PROMPT, shortlistTier, type AnalysisInput } from "@/lib/ai/product-analysis";
import { rankReviewPool } from "@/lib/ai/pool";
import { prisma } from "@/lib/db";

const positive = z.coerce.number().int().positive();
const { values } = parseArgs({ options: {
  version: { type: "string", default: "product-selection-v1" }, model: { type: "string" }, limit: { type: "string" },
  "pool-size": { type: "string", default: "400" }, "pool-only": { type: "boolean", default: false },
}, strict: true });
const promptVersion = "commercial-bundle-v1";
const analysisVersion = values.version;
const provider = process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "codex");
const model = values.model ?? (provider === "codex" ? process.env.AI_CODEX_MODEL ?? "codex-default" : process.env.OPENAI_MODEL ?? "gpt-5-mini");
const poolSize = positive.parse(values["pool-size"]);
const readmeMaxChars = positive.parse(process.env.AI_README_MAX_CHARS ?? "30000");
const concurrency = positive.max(4).parse(process.env.AI_CONCURRENCY ?? "2");
const batchSize = positive.max(12).parse(process.env.AI_BATCH_SIZE ?? "10");

const select = {
  id: true, githubFullName: true, repositoryUrl: true, githubDescription: true, githubTopics: true, githubHomepage: true,
  githubStars: true, githubPrimaryLanguage: true, githubPushedAt: true, githubLicenseSpdx: true, readmeText: true,
  repositoryKind: true, productLikenessScore: true, templatePotentialScore: true, candidateStatus: true,
} as const;
const candidates = await prisma.repository.findMany({ where: { candidateStatus: CandidateStatus.CANDIDATE }, orderBy: { id: "asc" }, select });
const reviews = await prisma.repository.findMany({ where: {
  candidateStatus: CandidateStatus.REVIEW, licenseCategory: LicenseCategory.PERMISSIVE, readmeStatus: ReadmeStatus.FETCHED,
  githubArchived: false, githubDisabled: false, daysSinceLastPush: { lte: 365 },
}, select });
const rankedReviews = rankReviewPool(reviews);
const pool = [...candidates, ...rankedReviews.slice(0, Math.max(0, poolSize - candidates.length))].slice(0, poolSize);
const run = await prisma.aiAnalysisRun.upsert({ where: { analysisVersion }, create: {
  analysisVersion, promptVersion, model, poolSize: pool.length,
}, update: { promptVersion, model, poolSize: pool.length }, });

const topics = (value: unknown): string[] => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
const makeInput = (repository: typeof pool[number]): AnalysisInput => ({
  fullName: repository.githubFullName ?? repository.repositoryUrl.replace("https://github.com/", ""), description: repository.githubDescription,
  topics: topics(repository.githubTopics), homepage: repository.githubHomepage, stars: repository.githubStars,
  primaryLanguage: repository.githubPrimaryLanguage, pushedAt: repository.githubPushedAt, license: repository.githubLicenseSpdx,
  readme: repository.readmeText ?? "", deterministicKind: repository.repositoryKind,
  productLikenessScore: repository.productLikenessScore, templatePotentialScore: repository.templatePotentialScore,
});
for (const [index, repository] of pool.entries()) {
  const input = makeInput(repository);
  const fingerprint = inputFingerprint(input, promptVersion);
  const existing = await prisma.repositoryAiAnalysis.findUnique({ where: { repositoryId_analysisVersion: { repositoryId: repository.id, analysisVersion } } });
  await prisma.repositoryAiAnalysis.upsert({ where: { repositoryId_analysisVersion: { repositoryId: repository.id, analysisVersion } }, create: {
    repositoryId: repository.id, runId: run.id, analysisVersion, promptVersion, model, poolRank: index + 1,
    poolSource: repository.candidateStatus === CandidateStatus.CANDIDATE ? AiPoolSource.CANDIDATE : AiPoolSource.REVIEW,
    inputFingerprint: fingerprint,
  }, update: {
    runId: run.id, poolRank: index + 1, poolSource: repository.candidateStatus === CandidateStatus.CANDIDATE ? AiPoolSource.CANDIDATE : AiPoolSource.REVIEW,
    ...(existing && existing.inputFingerprint !== fingerprint ? { inputFingerprint: fingerprint, status: AiAnalysisStatus.PENDING, errorCode: null, errorMessage: null } : {}),
  } });
}
console.info(JSON.stringify({ analysisVersion, poolSize: pool.length, currentCandidates: candidates.length, reviewAdded: pool.length - candidates.length }, null, 2));
if (values["pool-only"]) { await prisma.$disconnect(); process.exit(0); }

if (provider !== "openai" && provider !== "codex") throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
await prisma.repositoryAiAnalysis.updateMany({ where: { analysisVersion, status: AiAnalysisStatus.PROCESSING }, data: { status: AiAnalysisStatus.PENDING } });
const pending = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, orderBy: { poolRank: "asc" },
  ...(values.limit ? { take: positive.parse(values.limit) } : {}), include: { repository: true },
});
await prisma.aiAnalysisRun.update({ where: { id: run.id }, data: { status: AiAnalysisStatus.PROCESSING, startedAt: run.startedAt ?? new Date() } });
const openAiClient = provider === "openai" ? new OpenAiProductClient({ apiKey: z.string().trim().min(1, "OPENAI_API_KEY is required for AI_PROVIDER=openai").parse(process.env.OPENAI_API_KEY), model }) : null;
const codexClient = provider === "codex" ? new CodexCliProductClient(model === "codex-default" ? undefined : model) : null;
let cursor = 0; let completed = 0; let errors = 0; let requests = 0; let inputTokens = 0; let outputTokens = 0;
async function saveCompleted(item: typeof pending[number], analysis: Awaited<ReturnType<OpenAiProductClient["analyze"]>>["analysis"], raw: unknown): Promise<void> {
  await prisma.repositoryAiAnalysis.update({ where: { id: item.id }, data: { ...analysis,
    shortlistTier: shortlistTier(analysis.commercialBundleScore), rawResponse: raw as object,
    status: AiAnalysisStatus.COMPLETED, analyzedAt: new Date(), errorCode: null, errorMessage: null,
  } }); completed += 1;
}
async function saveFailed(item: typeof pending[number], cause: unknown): Promise<void> {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  await prisma.repositoryAiAnalysis.update({ where: { id: item.id }, data: { status: AiAnalysisStatus.FAILED,
    errorCode: error instanceof AiApiError ? error.code : "analysis_error", errorMessage: error.message.slice(0, 2000),
  } }); errors += 1;
}
async function worker(): Promise<void> {
  for (;;) {
    const item = pending[cursor++]; if (!item) return;
    const claim = await prisma.repositoryAiAnalysis.updateMany({ where: { id: item.id, status: { in: [AiAnalysisStatus.PENDING, AiAnalysisStatus.FAILED] } }, data: { status: AiAnalysisStatus.PROCESSING } });
    if (!claim.count) continue;
    const input = makeInput(item.repository);
    try {
      if (!openAiClient) throw new Error("OpenAI client is not configured");
      const result = await openAiClient.analyze(PRODUCT_ANALYSIS_SYSTEM_PROMPT, analysisPrompt(input, readmeMaxChars));
      requests += result.usage.requests; inputTokens += result.usage.inputTokens; outputTokens += result.usage.outputTokens;
      await saveCompleted(item, result.analysis, result.raw);
    } catch (cause) {
      await saveFailed(item, cause);
    }
    if ((completed + errors) % 10 === 0) console.info(`AI progress ${completed + errors}/${pending.length}; completed=${completed}; errors=${errors}`);
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
      const requested = active.map((item) => { const input = makeInput(item.repository); return { repositoryFullName: input.fullName, input: analysisPrompt(input, readmeMaxChars) }; });
      const result = await codexClient.analyzeBatch(PRODUCT_ANALYSIS_SYSTEM_PROMPT, requested);
      requests += result.usage.requests;
      const byName = new Map(result.analyses.map((analysis) => [analysis.repositoryFullName.toLowerCase(), analysis]));
      for (const item of active) {
        const fullName = makeInput(item.repository).fullName;
        const analysis = byName.get(fullName.toLowerCase());
        if (!analysis) { await saveFailed(item, new Error(`Batch response missing ${fullName}`)); continue; }
        const fields = aiProductAnalysisSchema.parse(analysis);
        await saveCompleted(item, fields, fields);
      }
    } catch (cause) {
      for (const item of active) await saveFailed(item, cause);
    }
    console.info(`AI progress ${completed + errors}/${pending.length}; completed=${completed}; errors=${errors}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => provider === "codex" ? batchWorker() : worker()));
const totals = await prisma.repositoryAiAnalysis.groupBy({ by: ["status"], where: { analysisVersion }, _count: true });
const totalCompleted = totals.find((entry) => entry.status === AiAnalysisStatus.COMPLETED)?._count ?? 0;
const totalErrors = totals.find((entry) => entry.status === AiAnalysisStatus.FAILED)?._count ?? 0;
await prisma.aiAnalysisRun.update({ where: { id: run.id }, data: { status: totalCompleted === pool.length ? AiAnalysisStatus.COMPLETED : AiAnalysisStatus.FAILED,
  completedCount: totalCompleted, errorCount: totalErrors, apiRequests: { increment: requests }, inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens },
  completedAt: totalCompleted === pool.length ? new Date() : null,
} });
console.info(JSON.stringify({ selected: pending.length, completed, errors, requests, inputTokens, outputTokens, totalCompleted, totalErrors }, null, 2));
await prisma.$disconnect();
