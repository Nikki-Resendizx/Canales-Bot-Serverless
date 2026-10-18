import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, channelSettings, captchaSessions, globalBans, knownUsers } from '../schema.js';

function renderWelcome(template, user, chat) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'usuario';
  const channelName = String(chat?.title ?? chat?.username ?? chat?.id ?? 'canal')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const escapedName = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const escapedUsername = user.username
    ? '@' + String(user.username).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    : '';
  return String(template || '👋 ¡Bienvenido, {nombre}!')
    .replaceAll('{mencion}', `<a href="tg://user?id=${user.id}">${escapedName}</a>`)
    .replaceAll('{nombre}', escapedName)
    .replaceAll('{username}', escapedUsername)
    .replaceAll('{userid}', String(user.id))
    .replaceAll('{canal}', channelName);
}

export default async function (update) {
  const chat = update?.chat;
  const member = update?.new_chat_member;
  const user = member?.user;
  if (!chat?.id || !user?.id || user.is_bot) return;
  const oldMember = update?.old_chat_member;
  const oldStatus = oldMember?.status;
  const isNowMember = ['member', 'administrator', 'creator'].includes(member.status) ||
    (member.status === 'restricted' && Boolean(member.is_member));
  const wasAlreadyMember = ['member', 'administrator', 'creator'].includes(oldStatus) ||
    (oldStatus === 'restricted' && Boolean(oldMember?.is_member));
  // Saludar y lanzar CAPTCHA solo en una entrada real, no al cambiar permisos.
  if (!isNowMember || wasAlreadyMember) return;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  await db.insert(knownUsers).values({
    userId: Number(user.id),
    username: String(user.username ?? '').toLowerCase(),
    displayName,
    lastSeenAt: Date.now(),
  }).onConflictDoUpdate({
    target: knownUsers.userId,
    set: {
      username: String(user.username ?? '').toLowerCase(),
      displayName,
      lastSeenAt: Date.now(),
    },
  }).run();

  const connectedChannel = await db.select().from(channels).where(eq(channels.chatId, Number(chat.id))).get();
  if (!connectedChannel || !Number(connectedChannel.active)) return;

  const banned = await db.select().from(globalBans).where(eq(globalBans.userId, user.id)).get();
  if (banned) {
    await api.banChatMember({ chat_id: chat.id, user_id: user.id, revoke_messages: true });
    return;
  }

  const settings = await db.select().from(channelSettings).where(eq(channelSettings.channelId, chat.id)).get();
  if (!settings) return;

  if (settings.welcomeEnabled) {
    await api.sendMessage({
      chat_id: chat.id,
      text: renderWelcome(settings.welcomeText, user, chat),
      parse_mode: 'HTML',
    });
  }

  if (!settings.captchaEnabled) return;
  const left = 1 + Math.floor(Math.random() * 8);
  const right = 1 + Math.floor(Math.random() * 8);
  const answer = left + right;
  const choices = new Set([answer, Math.max(2, answer - 1), answer + 1]);
  while (choices.size < 3) choices.add(answer + choices.size + 1);
  const sessionKey = `${chat.id}:${user.id}`;
  const now = Date.now();
  await db.insert(captchaSessions).values({
    sessionKey,
    userId: user.id,
    channelId: chat.id,
    expectedAnswer: String(answer),
    expiresAt: now + 600000,
    createdAt: now,
  }).onConflictDoUpdate({
    target: captchaSessions.sessionKey,
    set: { expectedAnswer: String(answer), expiresAt: now + 600000, createdAt: now },
  }).run();

  await api.sendMessage({
    chat_id: chat.id,
    text: `🔐 ${user.first_name ?? 'Usuario'}, responde para verificar que eres una persona: ¿cuánto es ${left} + ${right}? Tienes 10 minutos.`,
    reply_markup: { inline_keyboard: [[...choices].sort(() => Math.random() - 0.5).map((choice) => ({
      text: String(choice),
      callback_data: `captcha:${chat.id}:${user.id}:${choice}`,
    }))] },
  });
}
