import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseTelegramPage, parseViews } from "@/lib/telegram/parser";
import { normalizeGitHubRepositoryUrl, urlsFromText } from "@/lib/telegram/urls";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseTelegramPage", () => {
  it("parses the currently observed Telegram preview markup", () => {
    const result = parseTelegramPage(fixture("telegram-current.html"), "GitHubRadar");

    expect(result.messages).toHaveLength(2);
    expect(result.oldestMessageId).toBe(3095n);
    expect(result.nextPageUrl).toBe("https://t.me/s/GitHubRadar?before=3095");
    expect(result.messages[0]).toMatchObject({
      channelUsername: "GitHubRadar",
      telegramMessageId: 3095n,
      views: 4030n,
      githubLinks: ["https://github.com/tencent/vconsole"],
      externalLinks: [
        "https://github.com/Tencent/vConsole?utm_source=telegram",
        "https://example.com/docs?q=1",
      ],
    });
    expect(result.messages[0]?.publishedAt?.toISOString()).toBe("2026-08-21T19:18:52.000Z");
    expect(result.messages[0]?.html).toContain("<b>Tencent/vConsole</b>");
    expect(result.messages[0]?.rawSource).toContain("data-post=\"GitHubRadar/3095\"");
  });

  it("uses fallback selectors, captures edits, and deduplicates repository links", () => {
    const result = parseTelegramPage(
      fixture("telegram-alternative.html"),
      "GitHubRadar",
      "https://t.me/s/GitHubRadar?before=60",
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.editedAt?.toISOString()).toBe("2025-01-02T04:00:00.000Z");
    expect(result.messages[0]?.views).toBe(1200n);
    expect(result.messages[0]?.githubLinks).toEqual(["https://github.com/openai/openai-node"]);
    expect(result.nextPageUrl).toBe("https://t.me/s/GitHubRadar?before=40");
  });

  it("returns a terminal page when no message markup is available", () => {
    expect(parseTelegramPage(fixture("telegram-empty.html"), "GitHubRadar")).toEqual({
      messages: [],
      nextPageUrl: null,
      oldestMessageId: null,
    });
  });

  it("ignores another channel and duplicate selector matches", () => {
    const html = `
      <div class="js-widget_message tgme_widget_message" data-post="Other/1">
        <time datetime="2025-01-01T00:00:00Z"></time>
      </div>`;
    expect(parseTelegramPage(html, "GitHubRadar").messages).toHaveLength(0);
  });
});

describe("URL and view normalization", () => {
  it("does not absorb adjacent non-URL text into a plain GitHub URL", () => {
    expect(urlsFromText("https://github.com/CorentinTh/it-toolsНабор инструментов")).toEqual([
      "https://github.com/CorentinTh/it-tools",
    ]);
  });

  it.each([
    ["https://github.com/Owner/Repo.git", "https://github.com/owner/repo"],
    ["https://github.com/Owner/Repo/issues/1", "https://github.com/owner/repo"],
    ["http://github.com/facebook/react/issues/123", "https://github.com/facebook/react"],
    ["github.com/vercel/next.js/tree/canary/examples", "https://github.com/vercel/next.js"],
    ["https://github.com/foo/bar?utm_source=telegram", "https://github.com/foo/bar"],
    ["https://github.com/foo/bar/blob/main/README.md", "https://github.com/foo/bar"],
    ["https://github.com/foo/bar/releases/tag/v1", "https://github.com/foo/bar"],
    ["https://github.com/github/awesome-copilot", "https://github.com/github/awesome-copilot"],
    ["https://github.com/topics/typescript", null],
    ["https://github.com/trending", null],
    ["https://github.com/settings/profile", null],
    ["https://github.com/marketplace", null],
    ["https://gitlab.com/Owner/Repo", null],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeGitHubRepositoryUrl(input)?.canonicalUrl ?? null).toBe(expected);
  });

  it.each([
    ["4.03K", 4030n],
    ["1,2K", 1200n],
    ["2M", 2_000_000n],
    ["unknown", null],
  ])("parses views %s", (input, expected) => {
    expect(parseViews(input)).toBe(expected);
  });
});
