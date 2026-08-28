import { parseArgs } from "node:util";

import "dotenv/config";

import { prisma } from "@/lib/db";
import { metadataCandidateStatus } from "@/lib/screening/gate";
import { classifyLicense } from "@/lib/screening/license";

const { values } = parseArgs({ options: { source: { type: "string" } }, strict: true });
const sourceScope = values.source === undefined ? {} : values.source === "github-search"
  ? { githubSearchDiscoveries: { some: {} } }
  : (() => { throw new Error(`Unsupported --source: ${values.source}`); })();
const repositories = await prisma.repository.findMany({
  where: sourceScope,
  select: {
    id: true,
    githubLicenseSpdx: true,
    githubEnrichmentStatus: true,
    githubArchived: true,
    githubDisabled: true,
    daysSinceLastPush: true,
  },
});

for (const repository of repositories) {
  const license = classifyLicense(repository.githubLicenseSpdx);
  const candidateStatus = metadataCandidateStatus({
    enrichmentStatus: repository.githubEnrichmentStatus,
    archived: repository.githubArchived,
    disabled: repository.githubDisabled,
    licenseCategory: license.category,
    daysSinceLastPush: repository.daysSinceLastPush,
  });
  await prisma.repository.update({
    where: { id: repository.id },
    data: {
      licenseCategory: license.category,
      licenseReviewRequired: license.reviewRequired,
      commercialBundleCandidate: license.commercialBundleCandidate,
      candidateStatus,
    },
  });
}

const licenseCounts = await prisma.repository.groupBy({ by: ["licenseCategory"], _count: { _all: true } });
const candidateCounts = await prisma.repository.groupBy({ by: ["candidateStatus"], _count: { _all: true } });
console.info(JSON.stringify({
  processed: repositories.length,
  licenseCounts: Object.fromEntries(licenseCounts.map((row) => [row.licenseCategory.toLowerCase(), row._count._all])),
  candidateCounts: Object.fromEntries(candidateCounts.map((row) => [row.candidateStatus.toLowerCase(), row._count._all])),
}, null, 2));
await prisma.$disconnect();
