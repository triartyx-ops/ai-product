import "dotenv/config";
import { AiAnalysisStatus, AiShortlistTier } from "@prisma/client";

import { prisma } from "@/lib/db";

const previousVersion = "product-selection-v1";
const secondVersion = "business-gap-selection-v2";
const accepted = [AiShortlistTier.STRONG, AiShortlistTier.POSSIBLE];
const previous = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion: previousVersion, status: AiAnalysisStatus.COMPLETED, shortlistTier: { in: accepted } },
});
const second = await prisma.repositoryAiAnalysis.findMany({
  where: { analysisVersion: secondVersion, status: AiAnalysisStatus.COMPLETED, shortlistTier: { in: accepted } },
});
const selected = new Map<bigint, typeof previous[number]>();
for (const analysis of previous) selected.set(analysis.repositoryId, analysis);
for (const analysis of second) selected.set(analysis.repositoryId, analysis);
for (const analysis of selected.values()) {
  if (!analysis.shortlistTier || analysis.commercialBundleScore === null || !analysis.productCategory) throw new Error(`Incomplete accepted analysis ${analysis.id}`);
  const isSecond = analysis.analysisVersion === secondVersion;
  const rescued = isSecond && analysis.previousStageStatus !== null;
  const newGapFill = isSecond && analysis.previousStageStatus === null;
  await prisma.commercialCandidatePoolV2.upsert({ where: { repositoryId: analysis.repositoryId }, create: {
    repositoryId: analysis.repositoryId, analysisId: analysis.id, origin: rescued ? "rescued_false_negative" : newGapFill ? "new_gap_fill" : "existing_v1",
    shortlistTier: analysis.shortlistTier, bundleScore: analysis.commercialBundleScore, productCategory: analysis.productCategory, rescued, newGapFill,
  }, update: { analysisId: analysis.id, origin: rescued ? "rescued_false_negative" : newGapFill ? "new_gap_fill" : "existing_v1",
    shortlistTier: analysis.shortlistTier, bundleScore: analysis.commercialBundleScore, productCategory: analysis.productCategory, rescued, newGapFill },
  });
}
await prisma.commercialCandidatePoolV2.deleteMany({ where: { repositoryId: { notIn: [...selected.keys()] } } });
const distribution = await prisma.commercialCandidatePoolV2.groupBy({ by: ["shortlistTier"], _count: true });
console.info(JSON.stringify({ total: selected.size, tiers: Object.fromEntries(distribution.map((entry) => [entry.shortlistTier, entry._count])),
  rescued: second.filter((analysis) => analysis.previousStageStatus !== null).length,
  newGapFill: second.filter((analysis) => analysis.previousStageStatus === null).length,
}, null, 2));
await prisma.$disconnect();
