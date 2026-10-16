import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channelSettings, reactionCountReports } from '../schema.js';

function describeCount(item) {
  if (!item || typeof item !== 'object') return { emoji: 'reacción desconocida', count: 0 };
  const emoji = item.type === 'custom_emoji'
    ? `emoji personalizado (ID: ${item.custom_emoji_id ?? 'no disponible'})`
    : String(item.emoji ?? item.type ?? 'reacción');
  return { emoji, count: Number(item.total_count ?? 0) };
}

function postLink(chat, messageId) {
  if (chat?.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = String(chat?.id ?? '');
  if (/^-100\d+$/.test(id)) return `https://t.me/c/${id.slice(4)}/${messageId}`;
  return 'enlace no disponible';
}

export default async function (update) {
  const chat = update?.chat;
  const chatId = Number(chat?.id);
  const messageId = Number(update?.message_id);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) return;

  const settings = await db.select().from(channelSettings)
    .where(eq(channelSettings.channelId, chatId)).get();
  const reportChatId = Number(settings?.reactionReportChatId);
  if (!Number.isSafeInteger(reportChatId) || reportChatId === 0) return;

  const counts = (Array.isArray(update.reactions) ? update.reactions : []).map(describeCount);
  const timestamp = Date.now();
  const reportKey = `${chatId}:${messageId}:${timestamp}`;
  await db.insert(reactionCountReports).values({
    reportKey,
    channelId: chatId,
    messageId,
    countsJson: JSON.stringify(counts),
    createdAt: timestamp,
  }).run();

  const total = counts.reduce((sum, item) => sum + item.count, 0);
  await api.sendMessage({
    chat_id: reportChatId,
    text: [
      '📊 CONTEO DE REACCIONES (AGREGADO)',
      `Canal: ${chat?.title ?? chat?.username ?? chatId}`,
      `Publicación: ${postLink(chat, messageId)}`,
      `Reacciones totales: ${total}`,
      counts.length ? counts.map(item => `• ${item.emoji}: ${item.count}`).join('\n') : 'Sin reacciones actuales.',
      '',
      'ℹ️ Telegram entrega este evento como conteo agregado; no identifica a los usuarios.',
    ].join('\n'),
    link_preview_options: { is_disabled: true },
  });
}
