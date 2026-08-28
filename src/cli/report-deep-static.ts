import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import "dotenv/config";
import { DeepStaticClassification, DeepStaticStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

const inspectionVersion = process.argv.find((argument) => argument.startsWith("--version="))?.slice("--version=".length) ?? "deep-static-v1";
const outputPath = resolve(process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length) ?? "reports/deep-static-inspection-v1.json");
const run = await prisma.deepStaticInspectionRun.findUniqueOrThrow({ where: { inspectionVersion } });
const inspections = await prisma.repositoryDeepStaticInspection.findMany({ where: { inspectionVersion }, include: { repository: { include: { deepTestShortlistV1: true } } } });
const completed = inspections.filter((item) => item.status === DeepStaticStatus.INSPECTED);
const gitCloned = completed.filter((item) => !item.clonePath?.startsWith("github-api:"));
const apiFallback = completed.filter((item) => item.clonePath?.startsWith("github-api:"));
const values = (input: unknown): string[] => Array.isArray(input) ? input.filter((value): value is string => typeof value === "string") : [];
const object = (input: unknown): Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
const categoryDistribution = Object.fromEntries([...new Set(completed.map((item) => item.repository.deepTestShortlistV1?.category ?? "UNKNOWN"))].sort().map((category) => [category, {
  READY_FOR_SANDBOX: completed.filter((item) => item.repository.deepTestShortlistV1?.category === category && item.classification === DeepStaticClassification.READY_FOR_SANDBOX).length,
  REVIEW: completed.filter((item) => item.repository.deepTestShortlistV1?.category === category && item.classification === DeepStaticClassification.REVIEW).length,
  DROP: completed.filter((item) => item.repository.deepTestShortlistV1?.category === category && item.classification === DeepStaticClassification.DROP).length,
}]));
const top120 = completed.sort((a, b) => (b.deepStaticScore ?? -1) - (a.deepStaticScore ?? -1) || (a.repository.githubFullName ?? "").localeCompare(b.repository.githubFullName ?? "")).slice(0, 120).map((item, index) => ({
  rank: index + 1, repository: item.repository.githubFullName ?? item.repository.repositoryUrl, category: item.repository.deepTestShortlistV1?.category,
  score: item.deepStaticScore, classification: item.classification, stack: values(item.stack), packageManager: item.packageManager,
  database: values(object(item.database).types), docker: Boolean(object(item.docker).required), setupComplexity: item.setupComplexity,
  license: item.licenseDetected, licenseMatchesMetadata: item.licenseMatchesMetadata, reasons: values(item.classificationReasons),
}));
const dropReasons = completed.filter((item) => item.classification === DeepStaticClassification.DROP).map((item) => ({ repository: item.repository.githubFullName ?? item.repository.repositoryUrl, reasons: values(item.classificationReasons) }));
const countDatabase = (type: string): number => completed.filter((item) => values(object(item.database).types).includes(type)).length;
const report = { generatedAt: new Date(), inspectionVersion, run: { target: run.targetCount, inspected: run.inspectedCount, cloneFailures: run.cloneFailureCount, errors: run.errorCount },
  clonedSuccessfully: gitCloned.length, apiFallbackInspected: apiFallback.length, cloneFailures: inspections.filter((item) => item.status === DeepStaticStatus.CLONE_FAILED).map((item) => ({ repository: item.repository.githubFullName ?? item.repository.repositoryUrl, error: item.cloneError })),
  classifications: Object.fromEntries(Object.values(DeepStaticClassification).map((status) => [status, completed.filter((item) => item.classification === status).length])),
  dropReasons, categoryDistribution,
  infrastructure: { requiresDocker: completed.filter((item) => Boolean(object(item.docker).required)).length, postgresql: countDatabase("PostgreSQL"), mysql: countDatabase("MySQL/MariaDB"), sqlite: countDatabase("SQLite"),
    potentiallyPaidSaasOrApi: completed.filter((item) => values(item.paidDependencies).length > 0).length,
    fullyLocalLooking: completed.filter((item) => values(item.paidDependencies).length === 0 && !values(item.externalServices).some((service) => ["Supabase", "Firebase", "AWS/S3"].includes(service))).length,
    demoOrSeedData: completed.filter((item) => Boolean(object(item.seedDemo).present)).length,
    envExample: completed.filter((item) => Boolean(object(item.environment).hasExample)).length },
  top120,
};
await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdownPath = outputPath.replace(/\.json$/iu, ".md"); const cell = (value: unknown): string => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = top120.map((item) => `| ${item.rank} | ${cell(item.repository)} | ${item.category ?? "—"} | ${item.score} | ${item.classification} | ${cell(item.stack.join(", "))} | ${cell(item.database.join(", "))} | ${item.docker ? "yes" : "no"} | ${item.setupComplexity} |`).join("\n");
const markdown = `# Safe Static Deep Inspection\n\nGenerated: ${new Date().toISOString()}\n\nNo repository code, package manager, build, Docker, Makefile, or project script was executed.\n\n- Cloned successfully: ${completed.length}\n- Clone failures: ${report.cloneFailures.length}\n- READY_FOR_SANDBOX / REVIEW / DROP: ${report.classifications.READY_FOR_SANDBOX} / ${report.classifications.REVIEW} / ${report.classifications.DROP}\n- Docker: ${report.infrastructure.requiresDocker}; PostgreSQL: ${report.infrastructure.postgresql}; MySQL/MariaDB: ${report.infrastructure.mysql}; SQLite: ${report.infrastructure.sqlite}\n- Potentially paid SaaS/API: ${report.infrastructure.potentiallyPaidSaasOrApi}; fully local-looking: ${report.infrastructure.fullyLocalLooking}\n- Demo/seed: ${report.infrastructure.demoOrSeedData}; .env example: ${report.infrastructure.envExample}\n\n## Top 120 by deep_static_score\n\n| Rank | Repository | Category | Score | Decision | Stack | Database | Docker | Setup |\n|---:|---|---|---:|---|---|---|---|---|\n${rows}\n\n## Drops\n\n${dropReasons.length ? dropReasons.map((item) => `- ${item.repository}: ${item.reasons.join(" ")}`).join("\n") : "No static DROP decisions."}\n`;
await writeFile(markdownPath, markdown, "utf8");
console.info(JSON.stringify({ outputPath, markdownPath, clonedSuccessfully: gitCloned.length, apiFallbackInspected: apiFallback.length, cloneFailures: report.cloneFailures.length, classifications: report.classifications, infrastructure: report.infrastructure }, null, 2));
await prisma.$disconnect();
