import { githubReadmeResponseSchema, githubRepositoryResponseSchema, githubRepositorySearchResponseSchema, type GitHubReadmeResponse, type GitHubRepositoryResponse, type GitHubRepositorySearchResponse } from "./metadata";

export interface GitHubRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly rateLimit: GitHubRateLimit,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class GitHubRateLimitError extends GitHubApiError {
  constructor(message: string, status: number, rateLimit: GitHubRateLimit) {
    super(message, status, "rate_limited", rateLimit);
    this.name = "GitHubRateLimitError";
  }
}

export interface GitHubClientOptions {
  token: string;
  timeoutMs?: number;
  maxRetries?: number;
  onRequest?: (rateLimit: GitHubRateLimit) => void;
}

function rateLimitFromHeaders(headers: Headers): GitHubRateLimit {
  const parseInteger = (value: string | null): number | null => {
    if (!value || !/^\d+$/u.test(value)) return null;
    return Number(value);
  };
  const resetSeconds = parseInteger(headers.get("x-ratelimit-reset"));
  return {
    limit: parseInteger(headers.get("x-ratelimit-limit")),
    remaining: parseInteger(headers.get("x-ratelimit-remaining")),
    resetAt: resetSeconds === null ? null : new Date(resetSeconds * 1_000),
  };
}

function retryAfterMs(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
      return body.message;
    }
  } catch {
    // The status code remains actionable even if GitHub sends a non-JSON error.
  }
  return `GitHub returned HTTP ${response.status}`;
}

export class GitHubClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly options: GitHubClientOptions) {
    if (!options.token.trim()) throw new Error("GITHUB_TOKEN is required for authenticated enrichment.");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 4;
  }

  private async get<T>(url: string, parse: (body: unknown) => T): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.options.token}`,
            "User-Agent": "GitHubRadarIndexer/0.1",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const rateLimit = rateLimitFromHeaders(response.headers);
        this.options.onRequest?.(rateLimit);

        if (response.ok) return parse(await response.json());
        const message = await errorMessage(response);
        if (response.status === 404) throw new GitHubApiError(message, 404, "not_found", rateLimit);
        if (response.status === 429 || (response.status === 403 && rateLimit.remaining === 0)) {
          const retryMs = retryAfterMs(response.headers) ?? (rateLimit.resetAt ? rateLimit.resetAt.getTime() - Date.now() : null);
          if (retryMs !== null && retryMs <= 60_000 && attempt < this.maxRetries) {
            await wait(retryMs);
            continue;
          }
          throw new GitHubRateLimitError(message, response.status, rateLimit);
        }
        if (response.status >= 500) throw new GitHubApiError(message, response.status, `http_${response.status}`, rateLimit);
        throw new GitHubApiError(message, response.status, `http_${response.status}`, rateLimit);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        lastError = error;
        if (error instanceof GitHubApiError && (error.status === 404 || error.status === 403 || error.status === 429)) throw error;
        if (attempt >= this.maxRetries) break;
        await wait(Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
      }
    }

    if (lastError instanceof GitHubApiError) throw lastError;
    throw new GitHubApiError(lastError?.message ?? "GitHub request failed", null, "network_or_timeout", {
      limit: null,
      remaining: null,
      resetAt: null,
    });
  }

  async getRepository(owner: string, repo: string): Promise<GitHubRepositoryResponse> {
    return this.get(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      (body) => githubRepositoryResponseSchema.parse(body),
    );
  }

  async getReadme(owner: string, repo: string): Promise<GitHubReadmeResponse> {
    return this.get(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
      (body) => githubReadmeResponseSchema.parse(body),
    );
  }

  async searchRepositories(query: string, page = 1, perPage = 30): Promise<GitHubRepositorySearchResponse> {
    if (!Number.isInteger(page) || page < 1) throw new Error("GitHub Search page must be a positive integer.");
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw new Error("GitHub Search perPage must be between 1 and 100.");
    const params = new URLSearchParams({ q: query, page: String(page), per_page: String(perPage) });
    return this.get(`https://api.github.com/search/repositories?${params.toString()}`, (body) => githubRepositorySearchResponseSchema.parse(body));
  }
}
