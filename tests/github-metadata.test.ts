import { describe, expect, it } from "vitest";

import { githubRepositoryResponseSchema, mapGitHubMetadata } from "@/lib/github/metadata";

const response = githubRepositoryResponseSchema.parse({
  id: 10270250,
  node_id: "MDEwOlJlcG9zaXRvcnkxMDI3MDI1MA==",
  owner: { login: "facebook", avatar_url: "https://avatars.githubusercontent.com/u/69631?v=4" },
  name: "react",
  full_name: "facebook/react",
  html_url: "https://github.com/facebook/react",
  description: "The library for web and native user interfaces.",
  homepage: "https://react.dev",
  stargazers_count: 240000,
  forks_count: 50000,
  watchers_count: 240000,
  open_issues_count: 1000,
  subscribers_count: 7000,
  language: "JavaScript",
  topics: ["declarative", "frontend", "javascript"],
  size: 900000,
  default_branch: "main",
  created_at: "2013-05-24T16:15:54Z",
  updated_at: "2026-08-20T00:00:00Z",
  pushed_at: "2026-08-19T00:00:00Z",
  archived: false,
  disabled: false,
  fork: false,
  visibility: "public",
  license: { spdx_id: "MIT", name: "MIT License", url: "https://api.github.com/licenses/mit" },
});

describe("mapGitHubMetadata", () => {
  it("maps the single repository endpoint and computes time fields", () => {
    const metadata = mapGitHubMetadata(response, new Date("2026-08-24T00:00:00Z"));

    expect(metadata).toMatchObject({
      githubId: 10270250n,
      githubOwnerLogin: "facebook",
      githubFullName: "facebook/react",
      githubCanonicalUrl: "https://github.com/facebook/react",
      githubStars: 240000,
      githubTopics: ["declarative", "frontend", "javascript"],
      githubLicenseSpdx: "MIT",
      githubLicenseUrl: "https://api.github.com/licenses/mit",
      daysSinceLastPush: 5,
      repositoryAgeDays: 4839,
    });
  });

  it("keeps omitted optional API fields nullable", () => {
    const optional = { ...response, homepage: "", pushed_at: null, subscribers_count: undefined, topics: undefined, license: null };
    const metadata = mapGitHubMetadata(optional, new Date("2026-08-24T00:00:00Z"));

    expect(metadata.githubHomepage).toBeNull();
    expect(metadata.githubPushedAt).toBeNull();
    expect(metadata.daysSinceLastPush).toBeNull();
    expect(metadata.githubSubscribers).toBeNull();
    expect(metadata.githubTopics).toEqual([]);
    expect(metadata.githubLicenseSpdx).toBeNull();
  });
});
