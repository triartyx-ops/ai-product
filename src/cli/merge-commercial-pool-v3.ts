import "dotenv/config";
import { AiAnalysisStatus, AiShortlistTier } from "@prisma/client";

import { prisma } from "@/lib/db";

const selectionVersion = "business-selection-v1";
const accepted = [AiShortlistTier.STRONG, AiShortlistTier.POSSIBLE];
const v2 = await prisma.commercialCandidatePoolV2.findMany({ include: { analysis: true } });
const business = await prisma.repositoryBusinessAiAnalysis.findMany({ where: {
  selectionVersion, status: AiAnalysisStatus.COMPLETED, shortlistTier: { in: accepted },
} });
type Selection = {
  repositoryId: bigint; repositoryAiAnalysisId: bigint | null; businessAiAnalysisId: bigint | null;
  origin: string; shortlistTier: AiShortlistTier; bundleScore: number; category: string; buyerValueProposition: string | null;
};
const selected = new Map<bigint, Selection>();
for (const item of v2) selected.set(item.repositoryId, {
  repositoryId: item.repositoryId, repositoryAiAnalysisId: item.analysisId, businessAiAnalysisId: null,
  origin: "github_radar_v2", shortlistTier: item.shortlistTier, bundleScore: item.bundleScore,
  category: item.productCategory, buyerValueProposition: item.analysis.buyerValueProposition,
});
let duplicatesRemoved = 0;
for (const item of business) {
  if (!item.shortlistTier || item.commercialBundleScore === null || !item.productCategory) throw new Error(`Incomplete business analysis ${item.id}`);
  if (selected.has(item.repositoryId)) duplicatesRemoved += 1;
  selected.set(item.repositoryId, {
    repositoryId: item.repositoryId, repositoryAiAnalysisId: item.reusedFromAiAnalysisId,
    businessAiAnalysisId: item.id, origin: item.source === "REUSED_EXISTING" ? "reused_existing_analysis" : "github_search_business",
    shortlistTier: item.shortlistTier, bundleScore: item.commercialBundleScore,
    category: item.productCategory, buyerValueProposition: item.buyerValueProposition,
  });
}
for (const item of selected.values()) {
  await prisma.commercialCandidatePoolV3.upsert({ where: { repositoryId: item.repositoryId }, create: item, update: item });
}
await prisma.commercialCandidatePoolV3.deleteMany({ where: { repositoryId: { notIn: [...selected.keys()] } } });
const tiers = await prisma.commercialCandidatePoolV3.groupBy({ by: ["shortlistTier"], _count: true });
console.info(JSON.stringify({ previousV2: v2.length, acceptedBusinessAnalyses: business.length, duplicatesRemoved,
  commercialCandidatePoolV3: selected.size, tiers: Object.fromEntries(tiers.map((entry) => [entry.shortlistTier, entry._count])) }, null, 2));
await prisma.$disconnect();
