import { z } from "zod";

export const githubRepositoryResponseSchema = z.object({
  id: z.number().int().nonnegative(),
  node_id: z.string(),
  owner: z.object({ login: z.string(), avatar_url: z.string().url() }),
  name: z.string(),
  full_name: z.string(),
  html_url: z.string().url(),
  description: z.string().nullable(),
  homepage: z.string().nullable(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  watchers_count: z.number().int().nonnegative(),
  open_issues_count: z.number().int().nonnegative(),
  subscribers_count: z.number().int().nonnegative().optional(),
  language: z.string().nullable(),
  topics: z.array(z.string()).optional(),
  size: z.number().int().nonnegative(),
  default_branch: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  pushed_at: z.string().nullable(),
  archived: z.boolean(),
  disabled: z.boolean(),
  fork: z.boolean(),
  visibility: z.string().nullable().optional(),
  license: z.object({
    spdx_id: z.string().nullable(),
    name: z.string().nullable(),
    url: z.string().url().nullable(),
  }).nullable(),
});

export type GitHubRepositoryResponse = z.infer<typeof githubRepositoryResponseSchema>;

export const githubReadmeResponseSchema = z.object({
  content: z.string(),
  encoding: z.string(),
  sha: z.string(),
});

export type GitHubReadmeResponse = z.infer<typeof githubReadmeResponseSchema>;

// Repository Search returns a deliberately smaller representation than
// GET /repos/{owner}/{repo}; discovery stores it as provenance and enriches
// selected repositories through the canonical metadata endpoint afterwards.
export const githubRepositorySearchItemSchema = z.object({
  id: z.number().int().nonnegative(),
  node_id: z.string(),
  name: z.string(),
  full_name: z.string(),
  html_url: z.string().url(),
  owner: z.object({ login: z.string(), avatar_url: z.string().url() }),
  description: z.string().nullable(),
  fork: z.boolean(),
  archived: z.boolean(),
  disabled: z.boolean().optional().default(false),
  stargazers_count: z.number().int().nonnegative(),
  pushed_at: z.string().nullable(),
  license: z.object({ spdx_id: z.string().nullable() }).nullable().optional(),
}).passthrough();
export const githubRepositorySearchResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(githubRepositorySearchItemSchema),
});
export type GitHubRepositorySearchItem = z.infer<typeof githubRepositorySearchItemSchema>;
export type GitHubRepositorySearchResponse = z.infer<typeof githubRepositorySearchResponseSchema>;

export interface GitHubMetadataFields {
  githubId: bigint;
  githubNodeId: string;
  githubOwnerLogin: string;
  githubOwnerAvatar: string;
  githubName: string;
  githubFullName: string;
  githubCanonicalUrl: string;
  githubHtmlUrl: string;
  githubDescription: string | null;
  githubHomepage: string | null;
  githubStars: number;
  githubForks: number;
  githubWatchers: number;
  githubOpenIssues: number;
  githubSubscribers: number | null;
  githubPrimaryLanguage: string | null;
  githubTopics: string[];
  githubSize: number;
  githubDefaultBranch: string;
  githubCreatedAt: Date;
  githubUpdatedAt: Date;
  githubPushedAt: Date | null;
  githubArchived: boolean;
  githubDisabled: boolean;
  githubFork: boolean;
  githubVisibility: string | null;
  githubLicenseSpdx: string | null;
  githubLicenseName: string | null;
  githubLicenseUrl: string | null;
  daysSinceLastPush: number | null;
  repositoryAgeDays: number;
}

function asDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`GitHub returned an invalid timestamp: ${value}`);
  return date;
}

function ageInDays(earlier: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - earlier.getTime()) / 86_400_000));
}

export function mapGitHubMetadata(
  response: GitHubRepositoryResponse,
  now = new Date(),
): GitHubMetadataFields {
  const githubCreatedAt = asDate(response.created_at);
  const githubUpdatedAt = asDate(response.updated_at);
  const githubPushedAt = response.pushed_at ? asDate(response.pushed_at) : null;

  return {
    githubId: BigInt(response.id),
    githubNodeId: response.node_id,
    githubOwnerLogin: response.owner.login,
    githubOwnerAvatar: response.owner.avatar_url,
    githubName: response.name,
    githubFullName: response.full_name,
    githubCanonicalUrl: response.html_url,
    githubHtmlUrl: response.html_url,
    githubDescription: response.description,
    githubHomepage: response.homepage || null,
    githubStars: response.stargazers_count,
    githubForks: response.forks_count,
    githubWatchers: response.watchers_count,
    githubOpenIssues: response.open_issues_count,
    githubSubscribers: response.subscribers_count ?? null,
    githubPrimaryLanguage: response.language,
    githubTopics: response.topics ?? [],
    githubSize: response.size,
    githubDefaultBranch: response.default_branch,
    githubCreatedAt,
    githubUpdatedAt,
    githubPushedAt,
    githubArchived: response.archived,
    githubDisabled: response.disabled,
    githubFork: response.fork,
    githubVisibility: response.visibility ?? null,
    githubLicenseSpdx: response.license?.spdx_id ?? null,
    githubLicenseName: response.license?.name ?? null,
    githubLicenseUrl: response.license?.url ?? null,
    daysSinceLastPush: githubPushedAt ? ageInDays(githubPushedAt, now) : null,
    repositoryAgeDays: ageInDays(githubCreatedAt, now),
  };
}
