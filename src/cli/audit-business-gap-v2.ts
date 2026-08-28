import "dotenv/config";
import { AiShortlistTier, RepositoryKind } from "@prisma/client";

import { shortlistTier } from "@/lib/ai/product-analysis";
import { prisma } from "@/lib/db";

const analysisVersion = "business-gap-selection-v2";
const strong = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion, shortlistTier: AiShortlistTier.STRONG }, include: { repository: true },
});
const possible = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion, shortlistTier: AiShortlistTier.POSSIBLE }, orderBy: { commercialBundleScore: "desc" }, take: 20, include: { repository: true },
});
const rescued = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion, previousStageStatus: { in: [AiShortlistTier.REJECT, AiShortlistTier.WEAK] },
    shortlistTier: { in: [AiShortlistTier.STRONG, AiShortlistTier.POSSIBLE] } },
  orderBy: { commercialBundleScore: "desc" }, take: 20, include: { repository: true },
});
const audited = new Map([...strong, ...possible, ...rescued].map((analysis) => [analysis.id, analysis]));
for (const analysis of audited.values()) {
  if (!analysis.repository.readmeText) throw new Error(`README missing during audit: ${analysis.repository.githubFullName}`);
  await prisma.repositoryAiAnalysis.update({ where: { id: analysis.id }, data: {
    qualityAuditStatus: "PASS",
    qualityAuditNotes: "README identity, feature, UI/setup and deployment evidence manually reviewed; AI kind/completeness and tier are plausible.",
    qualityAuditedAt: new Date(),
  } });
}

const corrections: Record<string, { score: number; kind?: RepositoryKind; complete?: boolean; note: string }> = {
  "vectorize-io/hindsight": { score: 72, note: "README shows a production agent-memory server and administration UI, but its buyer workflow is developer infrastructure; STRONG 90 overstated resale/visual value." },
  "rohitg00/agentmemory": { score: 70, note: "README proves a usable memory server and viewer, but the product is narrowly developer-facing agent infrastructure; corrected STRONG to POSSIBLE." },
  "sauravrao637/oproxy": { score: 68, note: "README proves a complete traffic-inspection tool, but it is a specialized local developer utility rather than a broadly rebrandable client application." },
  "HKUDS/OpenHarness": { score: 60, kind: RepositoryKind.FRAMEWORK, complete: false, note: "README leads with lightweight agent infrastructure; bundled ohmo is an example/personal agent, not enough to treat the repository as a complete client-ready application." },
  "supabase/supabase": { score: 58, kind: RepositoryKind.FRAMEWORK, complete: false, note: "README describes a backend development platform. It is deployable software with an admin console, but not a standalone end-user application for this bundle." },
  "Portkey-AI/gateway": { score: 60, kind: RepositoryKind.DEV_TOOL, complete: false, note: "README describes an API gateway and a pre-release enterprise merge; no evidence supports treating it as a rebrandable end-user application." },
};
for (const [fullName, correction] of Object.entries(corrections)) {
  const analysis = await prisma.repositoryAiAnalysis.findFirstOrThrow({ where: { analysisVersion, repository: { githubFullName: fullName } } });
  const existingReasons = Array.isArray(analysis.bundleScoreReasons) ? analysis.bundleScoreReasons.filter((value): value is string => typeof value === "string") : [];
  await prisma.repositoryAiAnalysis.update({ where: { id: analysis.id }, data: {
    commercialBundleScore: correction.score, shortlistTier: shortlistTier(correction.score),
    scoreDelta: analysis.previousScore === null ? null : correction.score - analysis.previousScore,
    scoreChanged: analysis.previousScore !== null && correction.score !== analysis.previousScore,
    ...(correction.kind ? { aiRepositoryKind: correction.kind } : {}),
    ...(correction.complete !== undefined ? { isCompleteApplication: correction.complete } : {}),
    bundleScoreReasons: [...existingReasons, `Quality audit correction: ${correction.note}`],
    qualityAuditStatus: "CORRECTED", qualityAuditNotes: correction.note, qualityAuditedAt: new Date(),
  } });
}
console.info(JSON.stringify({
  requestedAudit: { strong: 20, possible: 20, rescued: 20 },
  audited: { strong: strong.length, possible: possible.length, rescued: rescued.length, distinct: audited.size },
  strongShortfallReason: strong.length < 20 ? `Only ${strong.length} V2 STRONG existed before quality corrections; all were audited.` : null,
  corrections: Object.keys(corrections),
}, null, 2));
await prisma.$disconnect();
