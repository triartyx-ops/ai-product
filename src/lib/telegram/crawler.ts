import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { fetchTelegramPage, wait } from "./fetcher";
import { parseTelegramPage } from "./parser";
import type { CrawlStats, ParsedTelegramMessage } from "./types";

export interface CrawlOptions {
  channelUsername: string;
  delayMs: number;
  timeoutMs: number;
  maxRetries: number;
  maxPages: number | null;
  startBefore: bigint | null;
  userAgent: string;
}

export interface CrawlResult extends CrawlStats {
  stoppedReason: "complete" | "max-pages" | "signal" | "pagination-loop" | "empty-page";
}

function previewUrl(channelUsername: string, before: bigint | null): string {
  const url = new URL(`https://t.me/s/${channelUsername}`);
  if (before !== null) url.searchParams.set("before", before.toString());
  return url.toString();
}

function toMessageUpsert(message: ParsedTelegramMessage, crawledAt: Date): Prisma.TelegramMessageUpsertArgs {
  const values = {
    publishedAt: message.publishedAt,
    editedAt: message.editedAt,
    text: message.text,
    html: message.html,
    externalLinks: message.externalLinks,
    githubLinks: message.githubLinks,
    views: message.views,
    rawSource: message.rawSource,
    crawlStatus: "PARSED" as const,
    crawledAt,
  };

  return {
    where: {
      channelUsername_telegramMessageId: {
        channelUsername: message.channelUsername,
        telegramMessageId: message.telegramMessageId,
      },
    },
    create: {
      channelUsername: message.channelUsername,
      telegramMessageId: message.telegramMessageId,
      ...values,
    },
    update: values,
  };
}

function pageSignature(messages: ParsedTelegramMessage[]): string {
  return messages.map((message) => message.telegramMessageId.toString()).join(",");
}

export async function crawlTelegramChannel(
  options: CrawlOptions,
  shouldStop: () => boolean = () => false,
): Promise<CrawlResult> {
  const resumable = options.startBefore === null
    ? await prisma.crawlJob.findFirst({
        where: { channelUsername: options.channelUsername, status: { in: ["RUNNING", "FAILED"] } },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  const hasCompletedCrawl = await prisma.crawlJob.findFirst({
    where: { channelUsername: options.channelUsername, status: "COMPLETED" },
    select: { id: true },
  });

  const initialUrl = previewUrl(options.channelUsername, options.startBefore);
  const job = resumable
    ? await prisma.crawlJob.update({
        where: { id: resumable.id },
        data: { status: "RUNNING", lastError: null },
      })
    : await prisma.crawlJob.create({
        data: { channelUsername: options.channelUsername, nextPageUrl: initialUrl },
      });

  let pageUrl = job.nextPageUrl ?? initialUrl;
  const stats: CrawlStats = {
    pagesProcessed: job.pagesProcessed,
    messagesFound: job.messagesFound,
    githubLinksFound: job.githubLinksFound,
    duplicatesSkipped: job.duplicatesSkipped,
    errors: job.errors,
  };
  const pagesAtStart = stats.pagesProcessed;
  const visitedUrls = new Set<string>();
  const visitedPageSignatures = new Set<string>();
  const seenMessageIds = new Set<string>();
  const incrementalStop = resumable === null && hasCompletedCrawl !== null && options.startBefore === null;
  let stoppedReason: CrawlResult["stoppedReason"] = "complete";

  try {
    while (pageUrl) {
      if (shouldStop()) {
        stoppedReason = "signal";
        break;
      }
      if (options.maxPages !== null && stats.pagesProcessed - pagesAtStart >= options.maxPages) {
        stoppedReason = "max-pages";
        break;
      }
      if (visitedUrls.has(pageUrl)) {
        stoppedReason = "pagination-loop";
        break;
      }
      visitedUrls.add(pageUrl);

      const source = await fetchTelegramPage(pageUrl, {
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        userAgent: options.userAgent,
        onFailure: async ({ attempt, error }) => {
          stats.errors += 1;
          console.error(`[retry ${attempt}] ${error.message}`);
          await prisma.$transaction([
            prisma.crawlFailure.create({ data: { crawlJobId: job.id, pageUrl, attempt, error: error.stack ?? error.message } }),
            prisma.crawlJob.update({ where: { id: job.id }, data: { errors: { increment: 1 }, lastError: error.message } }),
          ]);
        },
      });
      const page = parseTelegramPage(source, options.channelUsername, pageUrl);
      const signature = pageSignature(page.messages);
      if (page.messages.length === 0) {
        stoppedReason = "empty-page";
        break;
      }
      if (visitedPageSignatures.has(signature)) {
        stoppedReason = "pagination-loop";
        break;
      }
      visitedPageSignatures.add(signature);

      stats.pagesProcessed += 1;
      stats.messagesFound += page.messages.length;
      stats.githubLinksFound += page.messages.reduce((sum, message) => sum + message.githubLinks.length, 0);

      const uniquePageMessages = page.messages.filter((message) => {
        const key = message.telegramMessageId.toString();
        if (seenMessageIds.has(key)) {
          stats.duplicatesSkipped += 1;
          return false;
        }
        seenMessageIds.add(key);
        return true;
      });
      const existing = await prisma.telegramMessage.findMany({
        where: {
          channelUsername: options.channelUsername,
          telegramMessageId: { in: uniquePageMessages.map((message) => message.telegramMessageId) },
        },
        select: { telegramMessageId: true },
      });
      stats.duplicatesSkipped += existing.length;
      const allAlreadyKnown = uniquePageMessages.length > 0 && existing.length === uniquePageMessages.length;
      const nextPageUrl = incrementalStop && allAlreadyKnown ? null : page.nextPageUrl;
      const crawledAt = new Date();

      await prisma.$transaction([
        ...uniquePageMessages.map((message) => prisma.telegramMessage.upsert(toMessageUpsert(message, crawledAt))),
        prisma.crawlJob.update({
          where: { id: job.id },
          data: {
            nextPageUrl,
            pagesProcessed: stats.pagesProcessed,
            messagesFound: stats.messagesFound,
            githubLinksFound: stats.githubLinksFound,
            duplicatesSkipped: stats.duplicatesSkipped,
            lastError: null,
          },
        }),
      ]);

      console.info(
        `Page ${stats.pagesProcessed}: ${page.messages.length} messages, ` +
        `${page.messages.reduce((sum, message) => sum + message.githubLinks.length, 0)} GitHub links, ` +
        `oldest=${page.oldestMessageId?.toString() ?? "n/a"}`,
      );

      pageUrl = nextPageUrl ?? "";
      if (pageUrl) await wait(options.delayMs);
    }

    const paused = stoppedReason === "max-pages" || stoppedReason === "signal";
    await prisma.crawlJob.update({
      where: { id: job.id },
      data: paused
        ? { status: "RUNNING", nextPageUrl: pageUrl }
        : { status: "COMPLETED", nextPageUrl: null, completedAt: new Date() },
    });

    return { ...stats, stoppedReason };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    await prisma.crawlJob.update({
      where: { id: job.id },
      data: { status: "FAILED", nextPageUrl: pageUrl, lastError: error.message },
    });
    throw error;
  }
}
