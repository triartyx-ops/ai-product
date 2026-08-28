import { load } from "cheerio";

import type { ParsedTelegramMessage, ParsedTelegramPage } from "./types";
import {
  normalizeGitHubRepositoryUrl,
  normalizeUrl,
  uniqueUrls,
  urlsFromText,
} from "./urls";

const MESSAGE_SELECTORS = [
  ".js-widget_message[data-post]",
  ".tgme_widget_message[data-post]",
  "article[data-post]",
  "[data-post]",
] as const;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseViews(value: string | undefined): bigint | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/,/gu, ".").replace(/\s/gu, "").toUpperCase();
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/u.exec(cleaned);
  if (!match?.[1]) return null;

  const multiplier = match[2] === "K" ? 1_000 : match[2] === "M" ? 1_000_000 : match[2] === "B" ? 1_000_000_000 : 1;
  return BigInt(Math.round(Number(match[1]) * multiplier));
}

function absoluteBackwardUrl(
  href: string,
  currentPageUrl: string,
  channelUsername: string,
  oldestMessageId: bigint,
): string | null {
  try {
    const url = new URL(href, currentPageUrl);
    const cursor = url.searchParams.get("before");
    if (url.hostname !== "t.me" || !cursor || !/^\d+$/u.test(cursor)) return null;
    if (BigInt(cursor) > oldestMessageId) return null;

    const expectedPath = `/s/${channelUsername.toLowerCase()}`;
    if (url.pathname.toLowerCase() !== expectedPath) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseTelegramPage(
  source: string,
  channelUsername: string,
  currentPageUrl = `https://t.me/s/${channelUsername}`,
): ParsedTelegramPage {
  const $ = load(source);
  const messageElements = new Set<unknown>();

  for (const selector of MESSAGE_SELECTORS) {
    $(selector).each((_, element) => {
      messageElements.add(element);
    });
  }

  const messages: ParsedTelegramMessage[] = [];
  const pageIds = new Set<string>();

  for (const unknownElement of messageElements) {
    const element = unknownElement as Parameters<typeof $>[0];
    const root = $(element);
    const post = root.attr("data-post");
    if (!post) continue;

    const slash = post.lastIndexOf("/");
    const postChannel = post.slice(0, slash);
    const messageId = post.slice(slash + 1);
    if (
      slash < 1 ||
      postChannel.toLowerCase() !== channelUsername.toLowerCase() ||
      !/^\d+$/u.test(messageId) ||
      pageIds.has(messageId)
    ) {
      continue;
    }
    pageIds.add(messageId);

    const content = root.find(".js-message_text, .tgme_widget_message_text").first();
    const text = content.length > 0 ? content.text().replace(/\u00a0/gu, " ").trim() : null;
    const html = content.length > 0 ? content.html() : null;

    const linkCandidates: string[] = [];
    content.find("a[href]").each((_, anchor) => {
      const href = $(anchor).attr("href");
      if (href) linkCandidates.push(href);
    });
    if (text) linkCandidates.push(...urlsFromText(text));

    const externalLinks = uniqueUrls(
      linkCandidates
        .map((link) => normalizeUrl(link, currentPageUrl))
        .filter((link): link is string => link !== null),
    );
    const githubLinks = uniqueUrls(
      externalLinks
        .map(normalizeGitHubRepositoryUrl)
        .flatMap((link) => (link ? [link.canonicalUrl] : [])),
    );

    const publishedValue = root.find(".tgme_widget_message_date time[datetime], time[datetime]").first().attr("datetime");
    const editedValue = root
      .find(".tgme_widget_message_edited time[datetime], time.edited[datetime], [data-edited]")
      .first()
      .attr("datetime") ?? root.find("[data-edited]").first().attr("data-edited");

    messages.push({
      channelUsername,
      telegramMessageId: BigInt(messageId),
      publishedAt: parseDate(publishedValue),
      editedAt: parseDate(editedValue),
      text,
      html,
      externalLinks,
      githubLinks,
      views: parseViews(root.find(".tgme_widget_message_views, [data-views]").first().text() || root.attr("data-views")),
      rawSource: $.html(root),
    });
  }

  messages.sort((left, right) => Number(left.telegramMessageId - right.telegramMessageId));
  const oldestMessageId = messages[0]?.telegramMessageId ?? null;
  let nextPageUrl: string | null = null;

  if (oldestMessageId !== null) {
    const hrefCandidates: string[] = [];
    $("link[rel='prev'][href], a[data-before], a[href*='before=']").each((_, element) => {
      const href = $(element).attr("href");
      const before = $(element).attr("data-before");
      if (href) hrefCandidates.push(href);
      if (before && /^\d+$/u.test(before)) hrefCandidates.push(`/s/${channelUsername}?before=${before}`);
    });

    const validCandidates = uniqueUrls(
      hrefCandidates
        .map((href) => absoluteBackwardUrl(href, currentPageUrl, channelUsername, oldestMessageId))
        .filter((href): href is string => href !== null),
    );

    nextPageUrl = validCandidates
      .map((href) => ({ href, before: BigInt(new URL(href).searchParams.get("before") ?? "0") }))
      .sort((left, right) => Number(right.before - left.before))[0]?.href ?? null;

    // Telegram's preview has used ?before=<oldest id> consistently. This fallback
    // is only used when message markup survives but all navigation selectors change.
    if (!nextPageUrl && oldestMessageId > 1n) {
      nextPageUrl = `https://t.me/s/${channelUsername}?before=${oldestMessageId.toString()}`;
    }
  }

  return { messages, nextPageUrl, oldestMessageId };
}
