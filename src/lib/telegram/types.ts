export interface ParsedTelegramMessage {
  channelUsername: string;
  telegramMessageId: bigint;
  publishedAt: Date | null;
  editedAt: Date | null;
  text: string | null;
  html: string | null;
  externalLinks: string[];
  githubLinks: string[];
  views: bigint | null;
  rawSource: string;
}

export interface ParsedTelegramPage {
  messages: ParsedTelegramMessage[];
  nextPageUrl: string | null;
  oldestMessageId: bigint | null;
}

export interface CrawlStats {
  pagesProcessed: number;
  messagesFound: number;
  githubLinksFound: number;
  duplicatesSkipped: number;
  errors: number;
}
