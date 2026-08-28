import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import "dotenv/config";
import { DeepStaticStatus, Prisma } from "@prisma/client";

import { inspectRepository } from "@/lib/deep-static/inspector";
import { prisma } from "@/lib/db";

const { values } = parseArgs({ options: { version: { type: "string", default: "deep-static-v1" }, limit: { type: "string" }, cloneRoot: { type: "string", default: ".deep-static-cache" }, concurrency: { type: "string", default: "1" }, source: { type: "string", default: "github-api" }, "reinspect-drops": { type: "boolean", default: false } }, strict: true });
const inspectionVersion = values.version; const cloneRoot = resolve(values.cloneRoot);
const limit = values.limit ? Number(values.limit) : undefined;
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be an integer between 1 and 3");
if (values.source !== "github-api" && values.source !== "clone-first") throw new Error("--source must be github-api or clone-first");
function clone(repositoryUrl: string, directory: string): Promise<void> {
  return new Promise((resolveClone, reject) => {
    const child = spawn("git", ["-c", "protocol.file.allow=never", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false", "clone", "--depth=1", "--no-tags", repositoryUrl, directory], { stdio: "pipe" });
    let stderr = ""; child.stderr.on("data", (data: Buffer) => { stderr += data.toString("utf8"); });
    const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.on("error", reject); child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolveClone(); else reject(new Error(stderr.trim() || `git clone exited ${code}`)); });
  });
}

type GitTreeEntry = { path: string; type: string; size?: number };
function safePath(path: string): string | null { return path.startsWith("/") || path.split("/").includes("..") ? null : path; }
function selectedStaticPath(path: string): boolean {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  return /^(readme(?:\.[^.]+)?|license(?:\.[^.]+)?|copying(?:\.[^.]+)?|package\.json|composer\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|gemfile|dockerfile(?:\..+)?|docker-compose(?:\..+)?\.ya?ml|compose\.ya?ml|\.env(?:\..+)?|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|railway\.json|pnpm-workspace\.yaml|turbo\.json|nx\.json)$/iu.test(name)
    || /(?:^|\/)(?:migrations?|prisma\/schema\.prisma|seed|fixtures?|demo)(?:\/|\.|$)/iu.test(path);
}
async function githubJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "GitHubRadarIndexer/0.1" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub source API HTTP ${response.status}`); return response.json();
}
async function materializeGitHubStaticSource(owner: string, repo: string, ref: string, directory: string, token: string): Promise<{ path: string; size: bigint }> {
  await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true });
  const treeResponse = await githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token) as { tree?: GitTreeEntry[] };
  const tree = (treeResponse.tree ?? []).filter((entry) => entry.type === "blob" && safePath(entry.path) && selectedStaticPath(entry.path)).slice(0, 240);
  const withContent = tree.filter((entry) => /(?:^|\/)(?:readme(?:\.[^.]+)?|license(?:\.[^.]+)?|copying(?:\.[^.]+)?|package\.json|composer\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|gemfile|dockerfile(?:\..+)?|docker-compose(?:\..+)?\.ya?ml|compose\.ya?ml|\.env(?:\..+)?|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|railway\.json|pnpm-workspace\.yaml|turbo\.json|nx\.json)$/iu.test(entry.path))
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length || left.path.localeCompare(right.path)).slice(0, 24);
  const contentPaths = new Set(withContent.map((entry) => entry.path)); let size = 0n;
  for (const entry of tree) {
    const path = safePath(entry.path); if (!path) continue;
    const destination = join(directory, path); await mkdir(join(destination, ".."), { recursive: true });
    if (!contentPaths.has(path)) { await writeFile(destination, ""); size += BigInt(entry.size ?? 0); continue; }
    const payload = await githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, token) as { content?: string; encoding?: string; size?: number };
    const source = payload.encoding === "base64" && payload.content ? Buffer.from(payload.content.replace(/\n/g, ""), "base64") : Buffer.alloc(0);
    await writeFile(destination, source); size += BigInt(payload.size ?? entry.size ?? source.length);
  }
  return { path: directory, size };
}

await mkdir(cloneRoot, { recursive: true });
const shortlist = await prisma.deepTestShortlistV1.findMany({ orderBy: { rank: "asc" }, ...(limit ? { take: limit } : {}), include: { repository: true } });
const run = await prisma.deepStaticInspectionRun.upsert({ where: { inspectionVersion }, create: { inspectionVersion, targetCount: shortlist.length, status: DeepStaticStatus.PROCESSING, startedAt: new Date() }, update: { targetCount: shortlist.length, status: DeepStaticStatus.PROCESSING, startedAt: new Date() } });
await prisma.repositoryDeepStaticInspection.updateMany({ where: { inspectionVersion, status: DeepStaticStatus.PROCESSING }, data: { status: DeepStaticStatus.PENDING } });
if (values["reinspect-drops"]) await prisma.repositoryDeepStaticInspection.updateMany({ where: { inspectionVersion, classification: "DROP" }, data: { status: DeepStaticStatus.PENDING } });
for (const item of shortlist) {
  await prisma.repositoryDeepStaticInspection.upsert({ where: { repositoryId_inspectionVersion: { repositoryId: item.repositoryId, inspectionVersion } }, create: { repositoryId: item.repositoryId, runId: run.id, inspectionVersion }, update: { runId: run.id } });
}
const work = await prisma.repositoryDeepStaticInspection.findMany({ where: { inspectionVersion, repositoryId: { in: shortlist.map((item) => item.repositoryId) }, status: { in: [DeepStaticStatus.PENDING, DeepStaticStatus.FAILED, DeepStaticStatus.CLONE_FAILED] } }, orderBy: { id: "asc" }, include: { repository: true } });
let inspected = 0; let cloneFailures = 0; let errors = 0; let cursor = 0;
async function inspectOne(item: typeof work[number]): Promise<void> {
  const claimed = await prisma.repositoryDeepStaticInspection.updateMany({ where: { id: item.id, status: { in: [DeepStaticStatus.PENDING, DeepStaticStatus.FAILED, DeepStaticStatus.CLONE_FAILED] } }, data: { status: DeepStaticStatus.PROCESSING, cloneError: null } });
  if (!claimed.count) return;
  const directory = join(cloneRoot, String(item.repositoryId)); let sourcePath = directory; let sourceSize: bigint | undefined; let sourceMode = "git_clone";
  try {
    if (values.source === "github-api") throw new Error("Git clone skipped by source preference");
    await rm(directory, { recursive: true, force: true }); await clone(item.repository.githubCanonicalUrl ?? item.repository.repositoryUrl, directory);
  } catch (cause) {
    const cloneMessage = cause instanceof Error ? cause.message : String(cause); const token = process.env.GITHUB_TOKEN;
    if (!token) {
      cloneFailures += 1; await prisma.repositoryDeepStaticInspection.update({ where: { id: item.id }, data: { status: DeepStaticStatus.CLONE_FAILED, clonePath: directory, cloneError: cloneMessage.slice(0, 5_000) } });
      console.info(`Clone failed ${item.repository.githubFullName ?? item.repository.repositoryUrl}: ${cloneMessage.slice(0, 160)}`); return;
    }
    try {
      const fallbackDirectory = join(cloneRoot, `api-${item.repositoryId}`);
      const materialized = await materializeGitHubStaticSource(item.repository.githubOwner, item.repository.githubRepo, item.repository.githubDefaultBranch ?? "HEAD", fallbackDirectory, token);
      sourcePath = materialized.path; sourceSize = item.repository.githubSize === null ? materialized.size : BigInt(item.repository.githubSize) * 1024n; sourceMode = "github_api_fallback";
      console.info(`Clone fallback via GitHub API: ${item.repository.githubFullName ?? item.repository.repositoryUrl}`);
    } catch (fallbackCause) {
      cloneFailures += 1; const fallbackMessage = fallbackCause instanceof Error ? fallbackCause.message : String(fallbackCause);
      await prisma.repositoryDeepStaticInspection.update({ where: { id: item.id }, data: { status: DeepStaticStatus.CLONE_FAILED, clonePath: directory, cloneError: `${cloneMessage}\nFallback: ${fallbackMessage}`.slice(0, 5_000) } }); return;
    }
  }
  try {
    const result = await inspectRepository(sourcePath, item.repository.githubLicenseSpdx, sourceSize);
    const rawEvidence = { ...result.rawEvidence, sourceMode };
    await prisma.repositoryDeepStaticInspection.update({ where: { id: item.id }, data: { ...result, rawEvidence, status: DeepStaticStatus.INSPECTED, clonePath: sourceMode === "git_clone" ? directory : `github-api:${item.repository.githubFullName}`, inspectedAt: new Date(), cloneError: null } as Prisma.RepositoryDeepStaticInspectionUncheckedUpdateInput });
    inspected += 1;
  } catch (cause) {
    errors += 1; const message = cause instanceof Error ? cause.message : String(cause);
    await prisma.repositoryDeepStaticInspection.update({ where: { id: item.id }, data: { status: DeepStaticStatus.FAILED, clonePath: directory, cloneError: message.slice(0, 5_000) } });
  }
  if ((inspected + cloneFailures + errors) % 10 === 0) console.info(`Static inspection ${inspected + cloneFailures + errors}/${work.length}; inspected=${inspected}; cloneFailures=${cloneFailures}; errors=${errors}`);
}
async function worker(): Promise<void> { for (;;) { const item = work[cursor++]; if (!item) return; await inspectOne(item); } }
await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, () => worker()));
const grouped = await prisma.repositoryDeepStaticInspection.groupBy({ by: ["status"], where: { inspectionVersion }, _count: true });
const inspectedCount = grouped.find((entry) => entry.status === DeepStaticStatus.INSPECTED)?._count ?? 0;
const failureCount = grouped.find((entry) => entry.status === DeepStaticStatus.CLONE_FAILED)?._count ?? 0;
const errorCount = grouped.find((entry) => entry.status === DeepStaticStatus.FAILED)?._count ?? 0;
await prisma.deepStaticInspectionRun.update({ where: { id: run.id }, data: { inspectedCount, cloneFailureCount: failureCount, errorCount,
  status: inspectedCount + failureCount + errorCount === shortlist.length ? DeepStaticStatus.INSPECTED : DeepStaticStatus.FAILED,
  completedAt: inspectedCount + failureCount + errorCount === shortlist.length ? new Date() : null } });
console.info(JSON.stringify({ selection: shortlist.length, selected: work.length, inspected, cloneFailures, errors, totals: Object.fromEntries(grouped.map((entry) => [entry.status, entry._count])) }, null, 2));
await prisma.$disconnect();
