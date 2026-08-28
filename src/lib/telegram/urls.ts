const TRAILING_URL_PUNCTUATION = /[),.;:!?\]}]+$/u;
const GITHUB_NON_REPOSITORY_ROOTS = new Set([
  "about",
  "account",
  "actions",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "dashboard",
  "dependabot",
  "discussions",
  "enterprise",
  "events",
  "guides",
  "join",
  "explore",
  "features",
  "login",
  "marketplace",
  "mobile",
  "new",
  "notifications",
  "orgs",
  "plans",
  "pricing",
  "readme",
  "search",
  "security",
  "sessions",
  "settings",
  "signup",
  "skills",
  "solutions",
  "site",
  "sponsors",
  "stars",
  "support",
  "team",
  "topics",
  "trending",
  "users",
]);

export interface GitHubRepositoryUrl {
  owner: string;
  repo: string;
  canonicalUrl: string;
}

function cleanCandidate(value: string): string {
  return value.trim().replace(TRAILING_URL_PUNCTUATION, "");
}

export function normalizeUrl(value: string, baseUrl = "https://t.me/"): string | null {
  try {
    const candidate = cleanCandidate(value);
    const url = new URL(
      /^(?:www\.)?github\.com(?:\/|$)/iu.test(candidate) ? `https://${candidate}` : candidate,
      baseUrl,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.protocol === "http:" && url.port === "80") url.port = "";
    if (url.protocol === "https:" && url.port === "443") url.port = "";

    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeGitHubRepositoryUrl(value: string): GitHubRepositoryUrl | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  const url = new URL(normalized);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const owner = segments[0]?.toLowerCase();
  const rawRepository = segments[1]?.replace(/\.git$/iu, "").toLowerCase();
  if (!owner || !rawRepository || GITHUB_NON_REPOSITORY_ROOTS.has(owner)) return null;
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/u.test(owner)) return null;
  if (!/^[a-z\d._-]{1,100}$/u.test(rawRepository)) return null;

  return {
    owner,
    repo: rawRepository,
    canonicalUrl: `https://github.com/${owner}/${rawRepository}`,
  };
}

export function urlsFromText(text: string): string[] {
  return text.match(/(?:https?:\/\/|(?:www\.)?github\.com\/)[A-Za-z\d._~:/?#[\]@!$&'()*+,;=%-]+/gu) ?? [];
}

export function uniqueUrls(values: Iterable<string>): string[] {
  return [...new Set(values)];
}
