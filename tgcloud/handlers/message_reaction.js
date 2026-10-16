import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channelSettings, reactionReports } from '../schema.js';

function describeReaction(reaction) {
  if (!Array.isArray(reaction) || reaction.length === 0) return 'sin reacción';
  return reaction.map((item) => item.type === 'custom_emoji'
    ? `emoji personalizado (${item.custom_emoji_id ?? 'ID no disponible'})`
    : (item.emoji ?? item.type ?? 'reacción')).join(', ');
}

export default async function (update) {
  const chatId = update?.chat?.id;
  const messageId = update?.message_id;
  const user = update?.user;
  if (!chatId || !messageId || !user?.id) return;

  const settings = await db.select().from(channelSettings).where(eq(channelSettings.channelId, chatId)).get();
  if (!settings?.reactionReportChatId) return;

  const oldReaction = describeReaction(update.old_reaction);
  const newReaction = describeReaction(update.new_reaction);
  const timestamp = Date.now();
  const reportKey = `${chatId}:${messageId}:${user.id}:${timestamp}`;
  await db.insert(reactionReports).values({
    reportKey,
    channelId: chatId,
    messageId,
    userId: user.id,
    reaction: newReaction,
    createdAt: timestamp,
  }).run();

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Usuario';
  const username = user.username ? `@${user.username}` : 'sin username';
  const postLink = chatId < 0 ? `https://t.me/c/${String(chatId).replace('-100', '')}/${messageId}` : 'enlace no disponible';
  await api.sendMessage({
    chat_id: settings.reactionReportChatId,
    text: `🔔 REACCIÓN ACTUALIZADA\nCanal: ${update.chat.title ?? chatId}\nPublicación: ${postLink}\nUsuario: ${displayName}\nUsername: ${username}\nID: ${user.id}\nAntes: ${oldReaction}\nAhora: ${newReaction}`,
    link_preview_options: { is_disabled: true },
  });
}
