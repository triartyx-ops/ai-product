import { parseArgs } from "node:util";

import "dotenv/config";

import { prisma } from "@/lib/db";
import { classifyProduct } from "@/lib/screening/product";

function topics(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

const { values } = parseArgs({ options: { source: { type: "string" } }, strict: true });
const sourceScope = values.source === undefined ? {} : values.source === "github-search"
  ? { githubSearchDiscoveries: { some: {} } }
  : (() => { throw new Error(`Unsupported --source: ${values.source}`); })();
const repositories = await prisma.repository.findMany({
  where: sourceScope,
  select: {
    id: true, githubName: true, githubDescription: true, githubTopics: true, githubHomepage: true,
    githubPrimaryLanguage: true, readmeText: true, daysSinceLastPush: true, githubStars: true, candidateStatus: true,
  },
});
for (const repository of repositories) {
  const result = classifyProduct({
    name: repository.githubName ?? "", description: repository.githubDescription, topics: topics(repository.githubTopics),
    homepage: repository.githubHomepage, primaryLanguage: repository.githubPrimaryLanguage, readmeText: repository.readmeText,
    daysSinceLastPush: repository.daysSinceLastPush, stars: repository.githubStars,
  }, repository.candidateStatus);
  await prisma.repository.update({
    where: { id: repository.id },
    data: {
      repositoryKind: result.kind, productLikenessScore: result.productLikenessScore,
      productLikenessReasons: result.reasons, templatePotentialScore: result.templatePotentialScore,
      candidateStatus: result.candidateStatus,
    },
  });
}
console.info(`Classified ${repositories.length} repositories deterministically.`);
await prisma.$disconnect();
