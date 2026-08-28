import "dotenv/config";

import { prisma } from "@/lib/db";
import { parseTelegramPage } from "@/lib/telegram/parser";

const messages = await prisma.telegramMessage.findMany({
  orderBy: { id: "asc" },
  select: { id: true, channelUsername: true, telegramMessageId: true, rawSource: true },
});
let updated = 0;

for (const message of messages) {
  const parsed = parseTelegramPage(
    message.rawSource,
    message.channelUsername,
    `https://t.me/s/${message.channelUsername}`,
  ).messages.find((candidate) => candidate.telegramMessageId === message.telegramMessageId);
  if (!parsed) {
    throw new Error(`Could not reparse Telegram message ${message.channelUsername}/${message.telegramMessageId.toString()}`);
  }

  await prisma.telegramMessage.update({
    where: { id: message.id },
    data: { externalLinks: parsed.externalLinks, githubLinks: parsed.githubLinks },
  });
  updated += 1;
}

console.info(`Reparsed ${updated} Telegram messages from stored raw_source.`);
await prisma.$disconnect();
