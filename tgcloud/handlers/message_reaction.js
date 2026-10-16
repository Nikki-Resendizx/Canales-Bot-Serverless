import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channelSettings, reactionReports } from '../schema.js';

function describeReaction(reaction) {
  if (!Array.isArray(reaction) || reaction.length === 0) return 'sin reacción';

  return reaction.map((item) => {
    if (!item || typeof item !== 'object') return 'reacción desconocida';

    if (item.type === 'custom_emoji') {
      return `emoji personalizado (ID: ${item.custom_emoji_id ?? 'no disponible'})`;
    }

    if (item.type === 'emoji') return item.emoji ?? 'emoji';
    return item.emoji ?? item.type ?? 'reacción';
  }).join(', ');
}

function getPostLink(chat, messageId) {
  if (chat?.username) {
    return `https://t.me/${chat.username}/${messageId}`;
  }

  // Los enlaces /c/ usan el ID interno sin el prefijo -100 de supergrupos/canales.
  const chatId = String(chat?.id ?? '');
  if (chatId.startsWith('-100') && /^-100\d+$/.test(chatId)) {
    return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  }

  return 'enlace no disponible';
}

export default async function (update) {
  const chat = update?.chat;
  const chatId = chat?.id;
  const messageId = update?.message_id;
  const user = update?.user;

  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId) ||
      !Number.isSafeInteger(user?.id)) {
    return;
  }

  // No generamos informes si la reacción no cambió realmente.
  const oldReaction = describeReaction(update.old_reaction);
  const newReaction = describeReaction(update.new_reaction);
  if (JSON.stringify(update.old_reaction ?? []) === JSON.stringify(update.new_reaction ?? [])) {
    return;
  }

  const settings = await db
    .select()
    .from(channelSettings)
    .where(eq(channelSettings.channelId, chatId))
    .get();

  const reportChatId = settings?.reactionReportChatId;
  if (!Number.isSafeInteger(reportChatId) || reportChatId === 0) return;

  const timestamp = Date.now();
  // Incluir el estado anterior/nuevo reduce colisiones si llegan varias actualizaciones en el mismo milisegundo.
  const reportKey = `${chatId}:${messageId}:${user.id}:${timestamp}:${oldReaction}=>${newReaction}`;

  await db.insert(reactionReports).values({
    reportKey,
    channelId: chatId,
    messageId,
    userId: user.id,
    reaction: newReaction,
    createdAt: timestamp,
  }).run();

  const displayName = [user.first_name, user.last_name]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ') || 'Usuario';
  const username = user.username ? `@${user.username}` : 'sin username';
  const postLink = getPostLink(chat, messageId);

  await api.sendMessage({
    chat_id: reportChatId,
    text: [
      '🔔 REACCIÓN ACTUALIZADA',
      `Canal: ${chat.title ?? chat.username ?? chatId}`,
      `Publicación: ${postLink}`,
      `Usuario: ${displayName}`,
      `Username: ${username}`,
      `ID: ${user.id}`,
      `Antes: ${oldReaction}`,
      `Ahora: ${newReaction}`,
    ].join('\n'),
    link_preview_options: { is_disabled: true },
  });
}
