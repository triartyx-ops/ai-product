import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { ComplexityLevel, DeepStaticClassification } from "@prisma/client";

type JsonObject = Record<string, unknown>;

export type StaticInspection = {
  stack: string[]; frontend: string[]; backend: string[]; packageManager: string | null; isMonorepo: boolean;
  installCommands: string[]; runtimeCommands: string[]; hasTests: boolean; docker: JsonObject; environment: JsonObject;
  database: JsonObject; migrations: JsonObject; seedDemo: JsonObject; externalServices: string[]; paidDependencies: string[];
  deploymentConfigs: string[]; repositorySizeBytes: bigint; licenseFile: string | null; licenseDetected: string | null;
  licenseMatchesMetadata: boolean | null; suspiciousScripts: string[]; deprecatedDependencies: string[];
  appearsStandalone: boolean; setupComplexity: ComplexityLevel; deepStaticScore: number;
  classification: DeepStaticClassification; classificationReasons: string[]; rawEvidence: JsonObject;
};

const ignored = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor", ".venv", "venv", "target"]);
function unique(values: string[]): string[] { return [...new Set(values)].sort(); }
function json(value: unknown): JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {}; }
async function text(path: string, maximum = 250_000): Promise<string> {
  const data = await readFile(path); return data.subarray(0, maximum).toString("utf8");
}

export async function listRepositoryFiles(root: string): Promise<{ files: string[]; size: bigint }> {
  const files: string[] = []; let size = 0n;
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile() || files.length >= 8_000) continue;
      const fileStat = await stat(full); size += BigInt(fileStat.size); files.push(relative(root, full));
    }
  }
  await walk(root); return { files, size };
}

function matchAny(source: string, patterns: Array<[RegExp, string]>, destination: string[]): void {
  for (const [pattern, label] of patterns) if (pattern.test(source)) destination.push(label);
}

function licenseName(source: string): string | null {
  if (/apache license\s*(?:version )?2\.0|apache-2\.0/iu.test(source)) return "Apache-2.0";
  if (/mit license|permission is hereby granted, free of charge/iu.test(source)) return "MIT";
  if (/gnu (?:general public license|affero general public license)|\b(?:a?gpl)[ -]?[23]/iu.test(source)) return "GPL";
  if (/mozilla public license|mpl-2\.0/iu.test(source)) return "MPL-2.0";
  if (/bsd [23]-clause|redistribution and use in source and binary/iu.test(source)) return "BSD";
  if (/isc license/iu.test(source)) return "ISC";
  return null;
}

function normalizedLicense(value: string | null): string | null {
  if (!value) return null;
  if (/apache/iu.test(value)) return "Apache-2.0";
  if (/\bmit\b/iu.test(value)) return "MIT";
  if (/gpl|agpl|lgpl/iu.test(value)) return "GPL";
  if (/mozilla|mpl/iu.test(value)) return "MPL-2.0";
  if (/bsd/iu.test(value)) return "BSD";
  if (/isc/iu.test(value)) return "ISC";
  return value.toUpperCase();
}

export async function inspectRepository(root: string, metadataLicense: string | null, repositorySizeBytes?: bigint): Promise<StaticInspection> {
  const { files, size } = await listRepositoryFiles(root); const lowerFiles = files.map((file) => file.toLowerCase());
  const names = new Set(lowerFiles.map((file) => file.split("/").at(-1) ?? file));
  const manifests = files.filter((file) => file.endsWith("package.json"));
  const packageFiles: Array<{ path: string; value: JsonObject }> = [];
  for (const file of manifests.slice(0, 30)) { try { packageFiles.push({ path: file, value: json(JSON.parse(await text(join(root, file)))) }); } catch { /* malformed package metadata is evidence, not a crash */ } }
  const packageText = packageFiles.map((item) => JSON.stringify(item.value)).join("\n");
  const rootReadme = files.find((file) => /^readme(?:\.[^.]+)?$/iu.test(file)) ?? files.find((file) => /\/readme(?:\.[^.]+)?$/iu.test(file));
  const readme = rootReadme ? await text(join(root, rootReadme), 350_000).catch(() => "") : "";
  const stack: string[] = []; const frontend: string[] = []; const backend: string[] = [];
  const evidenceText = `${packageText}\n${readme}`;
  matchAny(evidenceText, [[/next(?:\.js)?/iu, "Next.js"], [/\breact\b/iu, "React"], [/vue(?:\.js)?/iu, "Vue"], [/svelte/iu, "Svelte"], [/angular/iu, "Angular"], [/laravel/iu, "Laravel"], [/django/iu, "Django"], [/fastapi/iu, "FastAPI"], [/flask/iu, "Flask"], [/nestjs/iu, "NestJS"], [/express/iu, "Express"], [/rails/iu, "Rails"], [/spring boot/iu, "Spring Boot"], [/phoenix/iu, "Phoenix"], [/golang|go\.mod/iu, "Go"], [/rust|cargo\.toml/iu, "Rust"]], stack);
  matchAny(evidenceText, [[/next(?:\.js)?/iu, "Next.js"], [/\breact\b/iu, "React"], [/vue(?:\.js)?/iu, "Vue"], [/svelte/iu, "Svelte"], [/angular/iu, "Angular"], [/tailwind/iu, "Tailwind CSS"]], frontend);
  matchAny(evidenceText, [[/laravel/iu, "Laravel"], [/django/iu, "Django"], [/fastapi/iu, "FastAPI"], [/nestjs/iu, "NestJS"], [/express/iu, "Express"], [/rails/iu, "Rails"], [/spring boot/iu, "Spring Boot"], [/phoenix/iu, "Phoenix"]], backend);
  if (names.has("go.mod")) stack.push("Go"); if (names.has("cargo.toml")) stack.push("Rust"); if (names.has("composer.json")) stack.push("PHP/Composer"); if (names.has("requirements.txt") || names.has("pyproject.toml")) stack.push("Python");
  const packageManager = names.has("pnpm-lock.yaml") ? "pnpm" : names.has("yarn.lock") ? "yarn" : names.has("bun.lockb") || names.has("bun.lock") ? "bun" : manifests.length ? "npm" : names.has("composer.lock") ? "composer" : names.has("poetry.lock") ? "poetry" : names.has("cargo.lock") ? "cargo" : null;
  const isMonorepo = names.has("pnpm-workspace.yaml") || names.has("turbo.json") || names.has("nx.json") || files.some((file) => /^(apps|packages|services)\//u.test(file)) || packageFiles.some(({ value }) => Boolean(value.workspaces));
  const scripts = packageFiles.flatMap(({ path, value }) => Object.entries(json(value.scripts)).map(([name, command]) => `${path}:${name}=${String(command)}`));
  const runtimeCommands = scripts.filter((entry) => /:(?:dev|start|build|serve|preview|test|test:|e2e|lint)=/u.test(entry));
  const documentedCommands = [...readme.matchAll(/(?:^|\n)\s*(?:npm|pnpm|yarn|bun|composer|poetry|pip|cargo)\s+(?:install|ci|run\s+(?:dev|start|build|test)|dev|start|build)\b[^\n]*/giu)].map((match) => match[0].trim());
  const defaultInstall = packageManager === "npm" ? "npm install" : packageManager === "pnpm" ? "pnpm install" : packageManager === "yarn" ? "yarn" : packageManager === "bun" ? "bun install" : packageManager === "composer" ? "composer install" : packageManager === "poetry" ? "poetry install" : packageManager === "cargo" ? "cargo build" : null;
  const installCommands = unique([...documentedCommands.filter((command) => /(?:install|\bci\b)/iu.test(command)), ...(defaultInstall ? [defaultInstall] : [])]);
  const hasTests = scripts.some((entry) => /:(?:test|test:|e2e|vitest|jest|pytest)=/iu.test(entry)) || files.some((file) => /(?:^|\/)(?:test|tests|__tests__|spec)\b/iu.test(file));
  const dockerFiles = files.filter((file) => /(?:^|\/)(?:dockerfile(?:\..+)?|docker-compose(?:\..+)?\.ya?ml|compose\.ya?ml)$/iu.test(file));
  const envFiles = files.filter((file) => /(?:^|\/)\.env(?:\.[\w-]+)?(?:\.example|\.sample|\.template)?$/iu.test(file) || /env\.example|example\.env/iu.test(file));
  const envText = await Promise.all(envFiles.slice(0, 20).map((file) => text(join(root, file), 100_000).catch(() => "")));
  const variables = unique((`${evidenceText}\n${envText.join("\n")}`.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []).filter((value) => !/^(README|MIT|GPL|API|URL|HTTP|HTTPS|JSON|SQL|CSS|HTML|CI|CD|UI|ID|JWT|UUID|POSTGRES)$/u.test(value))).slice(0, 150);
  const databaseTypes: string[] = []; matchAny(evidenceText, [[/postgres(?:ql)?/iu, "PostgreSQL"], [/mysql|mariadb/iu, "MySQL/MariaDB"], [/sqlite/iu, "SQLite"], [/mongodb|mongoose/iu, "MongoDB"], [/redis/iu, "Redis"]], databaseTypes);
  const migrationFiles = files.filter((file) => /(?:^|\/)(?:migrations?|prisma\/schema\.prisma|alembic|db\/migrate)/iu.test(file));
  const seedFiles = files.filter((file) => /(?:^|\/)(?:seed|fixtures?|demo(?:\.|\/|_))/iu.test(file) || /(?:seed|demo)/iu.test(file.split("/").at(-1) ?? ""));
  const externalServices: string[] = []; matchAny(evidenceText, [[/stripe/iu, "Stripe"], [/openai/iu, "OpenAI"], [/anthropic|claude/iu, "Anthropic"], [/twilio/iu, "Twilio"], [/sendgrid/iu, "SendGrid"], [/resend/iu, "Resend"], [/aws|s3/iu, "AWS/S3"], [/supabase/iu, "Supabase"], [/firebase/iu, "Firebase"], [/google oauth|google cloud/iu, "Google"], [/sentry/iu, "Sentry"]], externalServices);
  const paidDependencies = externalServices.filter((service) => ["Stripe", "OpenAI", "Anthropic", "Twilio", "SendGrid", "Resend", "AWS/S3", "Google"].includes(service));
  const deploymentConfigs = files.filter((file) => /(?:vercel\.json|netlify\.toml|render\.yaml|fly\.toml|railway|helm|kubernetes|k8s|docker-compose|terraform)/iu.test(file));
  const licenseFile = files.find((file) => /(?:^|\/)(?:license|copying)(?:\.[^.]+)?$/iu.test(file)) ?? null;
  const licenseDetected = licenseFile ? licenseName(await text(join(root, licenseFile), 30_000).catch(() => "")) : licenseName(readme);
  const normalizedMetadata = normalizedLicense(metadataLicense); const licenseMatchesMetadata = licenseDetected && normalizedMetadata ? licenseDetected === normalizedMetadata : null;
  const suspiciousScripts = scripts.filter((entry) => /:(?:preinstall|install|postinstall|prepare|prepack|postpack)=/iu.test(entry) || /(?:curl|wget|powershell|chmod \+x|\.\/scripts\/|node scripts\/)/iu.test(entry));
  const deprecatedDependencies: string[] = [];
  matchAny(packageText, [[/"node-sass"/iu, "node-sass"], [/"request"/iu, "request"], [/"bower"/iu, "bower"], [/"react"\s*:\s*"\^?(?:15|16)\./iu, "React <=16"], [/"next"\s*:\s*"\^?(?:9|10|11|12)\./iu, "Next.js <=12"], [/"angular"\s*:\s*"\^?[0-9]\./iu, "AngularJS/old Angular"]], deprecatedDependencies);
  const uiEvidence = frontend.length > 0 || /screenshots?|demo|dashboard|admin panel|web app|web application/iu.test(readme);
  const runtimePath = runtimeCommands.length > 0 || dockerFiles.length > 0 || /(?:installation|quick start|getting started|deploy)/iu.test(readme);
  const applicationSignals = /(?:crm|booking|inventory|dashboard|management|platform|application|system|self.host)/iu.test(`${readme}\n${packageText}`);
  const librarySignals = /(?:\b(?:sdk|library|framework|plugin|wrapper)\b)/iu.test(`${readme.slice(0, 5_000)}\n${packageText}`) && !uiEvidence;
  const appearsStandalone = Boolean(applicationSignals && runtimePath && (uiEvidence || dockerFiles.length));
  let score = 20 + (appearsStandalone ? 20 : 0) + (uiEvidence ? 12 : 0) + (runtimePath ? 12 : 0) + (dockerFiles.length ? 8 : 0) + (envFiles.length ? 5 : 0) + (hasTests ? 6 : 0) + (migrationFiles.length ? 5 : 0) + (seedFiles.length ? 4 : 0) + (deploymentConfigs.length ? 4 : 0) + (licenseMatchesMetadata !== false ? 4 : -12) + (deprecatedDependencies.length ? -8 : 0) + (paidDependencies.length ? -4 : 0);
  if (databaseTypes.length > 1) score -= 3; if (isMonorepo) score -= 3; score = Math.max(0, Math.min(100, score));
  const setupComplexity = score >= 78 && databaseTypes.length <= 1 && paidDependencies.length === 0 ? ComplexityLevel.LOW : score >= 55 ? ComplexityLevel.MEDIUM : ComplexityLevel.HIGH;
  const reasons: string[] = [];
  let classification: DeepStaticClassification = DeepStaticClassification.REVIEW;
  if (licenseMatchesMetadata === false && licenseDetected === "GPL" && normalizedMetadata !== "GPL") { classification = DeepStaticClassification.DROP; reasons.push("License file appears GPL while stored metadata is not GPL; legal mismatch requires exclusion."); }
  else if (librarySignals) { reasons.push("Library/SDK/framework wording is present without enough static UI evidence; retain for human review rather than auto-drop."); }
  else if (!runtimePath && !dockerFiles.length && !manifests.length) { reasons.push("No documented or detectable runtime path, package manifest, or container configuration in inspected files; retain for review."); }
  else if (score >= 75 && appearsStandalone && licenseMatchesMetadata !== false) { classification = DeepStaticClassification.READY_FOR_SANDBOX; reasons.push("Documented runtime path, standalone product evidence and self-hosting signals are present."); }
  else { reasons.push("Static evidence is insufficient for an automated sandbox-ready decision; review setup and runtime behavior without executing code."); }
  return { stack: unique(stack), frontend: unique(frontend), backend: unique(backend), packageManager, isMonorepo, installCommands, runtimeCommands, hasTests,
    docker: { files: dockerFiles, required: dockerFiles.length > 0 }, environment: { exampleFiles: envFiles, variables, hasExample: envFiles.length > 0 },
    database: { types: unique(databaseTypes), required: databaseTypes.length > 0 }, migrations: { files: migrationFiles.slice(0, 100), present: migrationFiles.length > 0 },
    seedDemo: { files: seedFiles.slice(0, 100), present: seedFiles.length > 0 }, externalServices: unique(externalServices), paidDependencies: unique(paidDependencies), deploymentConfigs: unique(deploymentConfigs),
    repositorySizeBytes: repositorySizeBytes ?? size, licenseFile, licenseDetected, licenseMatchesMetadata, suspiciousScripts, deprecatedDependencies: unique(deprecatedDependencies), appearsStandalone,
    setupComplexity, deepStaticScore: score, classification, classificationReasons: reasons, rawEvidence: { fileCount: files.length, readme: rootReadme, manifestFiles: manifests, scripts: scripts.slice(0, 200), uiEvidence, runtimePath, applicationSignals, librarySignals },
  };
}
