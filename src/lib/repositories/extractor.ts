import { normalizeGitHubRepositoryUrl, normalizeUrl, type GitHubRepositoryUrl } from "@/lib/telegram/urls";

export type GitHubPathKind = "issues" | "tree" | "blob" | "releases" | "other" | "root";

export interface ClassifiedGitHubLink {
  rawUrl: string;
  repository: GitHubRepositoryUrl | null;
  pathKind: GitHubPathKind | null;
  hasDotGit: boolean;
}

function githubUrl(value: string): URL | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  return url.hostname === "github.com" || url.hostname === "www.github.com" ? url : null;
}

export function isGitHubUrl(value: string): boolean {
  return githubUrl(value) !== null;
}

export function classifyGitHubLink(rawUrl: string): ClassifiedGitHubLink | null {
  const url = githubUrl(rawUrl);
  if (!url) return null;

  const repository = normalizeGitHubRepositoryUrl(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const pathSegment = segments[2]?.toLowerCase();
  const pathKind: GitHubPathKind | null = !repository
    ? null
    : pathSegment === "issues" || pathSegment === "tree" || pathSegment === "blob" || pathSegment === "releases"
      ? pathSegment
      : segments.length > 2
        ? "other"
        : "root";

  return {
    rawUrl,
    repository,
    pathKind,
    hasDotGit: Boolean(segments[1] && /\.git$/iu.test(segments[1])),
  };
}
