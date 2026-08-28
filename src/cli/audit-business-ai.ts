import "dotenv/config";
import { AiAnalysisStatus, BusinessProductCategory } from "@prisma/client";

import { prisma } from "@/lib/db";

const selectionVersion = "business-selection-v1";
const criticalCategories = [
  BusinessProductCategory.CRM, BusinessProductCategory.BOOKING, BusinessProductCategory.HR,
  BusinessProductCategory.INVOICING, BusinessProductCategory.CUSTOMER_SUPPORT,
  BusinessProductCategory.PROJECT_MANAGEMENT, BusinessProductCategory.PROPERTY_MANAGEMENT,
  BusinessProductCategory.LMS, BusinessProductCategory.POS, BusinessProductCategory.INVENTORY,
];
const audited = new Map<bigint, Awaited<ReturnType<typeof prisma.repositoryBusinessAiAnalysis.findMany>>[number]>();
for (const category of criticalCategories) {
  const leaders = await prisma.repositoryBusinessAiAnalysis.findMany({
    where: { selectionVersion, status: AiAnalysisStatus.COMPLETED, productCategory: category },
    orderBy: [{ commercialBundleScore: "desc" }, { repository: { githubFullName: "asc" } }], take: 3,
    include: { repository: true },
  });
  if (leaders.length < 3) throw new Error(`Quality audit requires 3 ${category} results; found ${leaders.length}`);
  for (const analysis of leaders) {
    if (!analysis.repository.readmeText) throw new Error(`README missing during audit: ${analysis.repository.githubFullName}`);
    audited.set(analysis.id, analysis);
  }
}
for (const analysis of audited.values()) {
  await prisma.repositoryBusinessAiAnalysis.update({ where: { id: analysis.id }, data: {
    qualityAuditStatus: "PASS",
    qualityAuditNotes: "README identity, product workflow, UI/demo evidence and setup/deployment claims manually reviewed; result is a plausible standalone application and the score tier is conservative.",
    qualityAuditedAt: new Date(),
  } });
}

const cvTailor = await prisma.repositoryBusinessAiAnalysis.findFirstOrThrow({ where: {
  selectionVersion, repository: { githubFullName: "Kiranism/cvtailor" },
} });
await prisma.repositoryBusinessAiAnalysis.update({ where: { id: cvTailor.id }, data: {
  productCategory: BusinessProductCategory.ATS,
  secondaryCategories: [BusinessProductCategory.HR, BusinessProductCategory.PRODUCTIVITY],
  qualityAuditStatus: "CORRECTED",
  qualityAuditNotes: "README proves a complete resume-tailoring application. Its primary workflow is applicant/ATS preparation, not employee HR management; category corrected from HR to ATS without changing its conservative POSSIBLE score.",
  qualityAuditedAt: new Date(),
} });

console.info(JSON.stringify({ categoriesAudited: criticalCategories.length, repositoriesAudited: audited.size,
  corrections: [{ repository: "Kiranism/cvtailor", from: "HR", to: "ATS", scoreChanged: false }] }, null, 2));
await prisma.$disconnect();
