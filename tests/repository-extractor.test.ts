import { describe, expect, it } from "vitest";

import { classifyGitHubLink } from "@/lib/repositories/extractor";

describe("classifyGitHubLink", () => {
  it.each([
    ["https://github.com/facebook/react/issues/123", "issues", false],
    ["https://github.com/vercel/next.js/tree/canary/examples", "tree", false],
    ["https://github.com/nodejs/node/blob/main/README.md", "blob", false],
    ["https://github.com/rust-lang/rust/releases/tag/1.0", "releases", false],
    ["https://github.com/foo/bar.git", "root", true],
    ["https://github.com/foo/bar/pulls", "other", false],
  ])("classifies %s", (rawUrl, pathKind, hasDotGit) => {
    const result = classifyGitHubLink(rawUrl);
    expect(result?.pathKind).toBe(pathKind);
    expect(result?.hasDotGit).toBe(hasDotGit);
    expect(result?.repository?.canonicalUrl).toBe("https://github.com/" + (rawUrl.includes("facebook") ? "facebook/react" : rawUrl.includes("vercel") ? "vercel/next.js" : rawUrl.includes("nodejs") ? "nodejs/node" : rawUrl.includes("rust-lang") ? "rust-lang/rust" : "foo/bar"));
  });

  it("marks GitHub system paths as invalid instead of repositories", () => {
    expect(classifyGitHubLink("https://github.com/topics/typescript")?.repository).toBeNull();
    expect(classifyGitHubLink("https://github.com/trending")?.repository).toBeNull();
  });

  it("allows repositories owned by the GitHub organization", () => {
    expect(classifyGitHubLink("https://github.com/github/spec-kit")?.repository).toMatchObject({
      owner: "github",
      repo: "spec-kit",
      canonicalUrl: "https://github.com/github/spec-kit",
    });
  });
});
