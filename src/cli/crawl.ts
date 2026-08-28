import { parseArgs } from "node:util";

import "dotenv/config";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { crawlTelegramChannel } from "@/lib/telegram/crawler";

const positiveInteger = z.coerce.number().int().positive();
const nonNegativeInteger = z.coerce.number().int().nonnegative();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CRAWL_DELAY_MS: nonNegativeInteger.default(1500),
  CRAWL_TIMEOUT_MS: positiveInteger.default(20_000),
  CRAWL_MAX_RETRIES: nonNegativeInteger.max(10).default(4),
  CRAWL_USER_AGENT: z.string().min(10).default("GitHubRadarIndexer/0.1 (public-preview crawler)"),
});

const channelSchema = z.string().trim().transform((value) => {
  const withoutUrl = value.replace(/^https?:\/\/t\.me\/(?:s\/)?/iu, "");
  return withoutUrl.replace(/^@/u, "").replace(/\/$/u, "");
}).pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/u, "Invalid Telegram channel username"));

const { values } = parseArgs({
  options: {
    channel: { type: "string", short: "c", default: "GitHubRadar" },
    "delay-ms": { type: "string" },
    "timeout-ms": { type: "string" },
    "max-retries": { type: "string" },
    "max-pages": { type: "string" },
    "start-before": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
  strict: true,
});

if (values.help) {
  console.info(`Usage: npm run crawl -- [options]

Options:
  --channel, -c <username>  Public Telegram channel (default: GitHubRadar)
  --delay-ms <number>       Delay between successful page requests
  --timeout-ms <number>     HTTP request timeout
  --max-retries <number>    Retries for network, 429, and 5xx failures
  --max-pages <number>      Pause safely after this many pages
  --start-before <id>       Start a new crawl at an explicit cursor
  --help, -h                Show this help`);
  process.exit(0);
}

const env = envSchema.parse(process.env);
const channelUsername = channelSchema.parse(values.channel);
const maxPages = values["max-pages"] === undefined ? null : positiveInteger.parse(values["max-pages"]);
const startBefore = values["start-before"] === undefined
  ? null
  : z.coerce.bigint().positive().parse(values["start-before"]);
let stopRequested = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopRequested = true;
    console.info(`\n${signal} received; stopping after the current page...`);
  });
}

try {
  console.info(`Crawling https://t.me/s/${channelUsername} sequentially...`);
  const result = await crawlTelegramChannel(
    {
      channelUsername,
      delayMs: values["delay-ms"] === undefined ? env.CRAWL_DELAY_MS : nonNegativeInteger.parse(values["delay-ms"]),
      timeoutMs: values["timeout-ms"] === undefined ? env.CRAWL_TIMEOUT_MS : positiveInteger.parse(values["timeout-ms"]),
      maxRetries: values["max-retries"] === undefined ? env.CRAWL_MAX_RETRIES : nonNegativeInteger.max(10).parse(values["max-retries"]),
      maxPages,
      startBefore,
      userAgent: env.CRAWL_USER_AGENT,
    },
    () => stopRequested,
  );

  console.info(`
Pages processed:     ${result.pagesProcessed}
Messages found:      ${result.messagesFound}
GitHub links found:  ${result.githubLinksFound}
Duplicates skipped: ${result.duplicatesSkipped}
Errors:              ${result.errors}
Stopped:             ${result.stoppedReason}`);
} catch (cause) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  console.error(`Crawl failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
