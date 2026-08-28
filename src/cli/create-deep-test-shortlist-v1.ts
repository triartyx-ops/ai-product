import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import "dotenv/config";

import { selectDeepTestCandidates, type DeepTestCandidate } from "@/lib/ai/deep-test-selection";
import { prisma } from "@/lib/db";

const pool = await prisma.commercialCandidatePoolV3.findMany({ include: { repository: true, businessAiAnalysis: true } });
const candidates: DeepTestCandidate[] = pool.map((item) => ({
  id: item.repositoryId, repository: item.repository.githubFullName ?? item.repository.repositoryUrl,
  category: item.category, bundleScore: item.bundleScore,
  description: item.businessAiAnalysis?.shortProductDescription ?? item.repository.githubDescription,
  buyerValueProposition: item.buyerValueProposition,
  businessUsefulnessScore: item.businessAiAnalysis?.businessUsefulnessScore ?? null,
  easeOfDeploymentScore: item.businessAiAnalysis?.easeOfDeploymentScore ?? null,
  easeOfCustomizationScore: item.businessAiAnalysis?.easeOfCustomizationScore ?? null,
  visualValueScore: item.businessAiAnalysis?.visualValueScore ?? null,
  clientProjectPotentialScore: item.businessAiAnalysis?.clientProjectPotentialScore ?? null,
  endUserClarityScore: item.businessAiAnalysis?.endUserClarityScore ?? null,
}));
const result = selectDeepTestCandidates(candidates, 150);
const poolByRepository = new Map(pool.map((item) => [item.repositoryId, item]));
await prisma.$transaction(async (tx) => {
  await tx.deepTestShortlistV1.deleteMany();
  await tx.deepTestShortlistV1.createMany({ data: result.selected.map((item, index) => {
    const poolItem = poolByRepository.get(item.id); if (!poolItem) throw new Error(`Pool item missing for ${item.repository}`);
    return { repositoryId: item.id, candidatePoolId: poolItem.id, rank: index + 1, category: item.category,
      bundleScore: item.bundleScore, selectionScore: item.selectionScore, reasonSelected: item.reasonSelected };
  }) });
});
const distribution = Object.fromEntries([...new Set(result.selected.map((item) => item.category))].sort().map((category) =>
  [category, result.selected.filter((item) => item.category === category).length]));
const groupDistribution = Object.fromEntries([...new Set(result.selected.map((item) => item.selectionGroup))].sort().map((group) =>
  [group, result.selected.filter((item) => item.selectionGroup === group).length]));
const evidence = { generatedAt: new Date(), poolSize: pool.length, selected: result.selected.length, distribution, groupDistribution,
  nearDuplicateProductsIntentionallyNotSelected: result.nearDuplicates };
const outputPath = resolve("reports/deep-test-shortlist-v1-selection.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.info(JSON.stringify({ outputPath, ...evidence }, null, 2));
await prisma.$disconnect();
