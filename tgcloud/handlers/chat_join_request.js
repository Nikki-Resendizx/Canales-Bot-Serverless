import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { admins, channels, joinRequests } from '../schema.js';

const OWNER_ID = 8624574996;

export default async function (update) {
  const chat = update?.chat;
  const user = update?.from;
  if (!chat?.id || !user?.id || !['group', 'supergroup', 'channel'].includes(chat.type)) return;

  const chatId = Number(chat.id);
  const userId = Number(user.id);
  const requestKey = chatId + ':' + userId;
  const existing = await db.select().from(joinRequests).where(eq(joinRequests.requestKey, requestKey)).get();
  if (existing && existing.status !== 'pending') return;

  const now = Date.now();
  if (!existing) {
    await db.insert(joinRequests).values({
      requestKey,
      chatId,
      userId,
      requesterName: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Usuario',
      username: String(user.username || ''),
      bio: String(update.bio || ''),
      inviteLink: String(update.invite_link?.invite_link || ''),
      status: 'pending',
      requestedAt: Number(update.date || Math.floor(now / 1000)) * 1000,
    }).onConflictDoNothing().run();
  }

  // Un chat que envía chat_join_request ya tiene al bot como administrador;
  // se registra para que las acciones posteriores puedan validar permisos.
  await db.insert(channels).values({
    chatId,
    title: String(chat.title || chat.username || chatId),
    addedBy: OWNER_ID,
    active: 1,
    createdAt: now,
  }).onConflictDoNothing().run();

  const channelAdmins = await db.select().from(admins).all();
  const recipients = new Set([OWNER_ID, ...channelAdmins.map(row => Number(row.userId))]);
  const requesterName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Usuario';
  const username = user.username ? '@' + user.username : 'No disponible';
  const bio = String(update.bio || '').trim();
  const text = [
    '📥 NUEVA SOLICITUD DE INGRESO',
    '',
    'Destino: ' + String(chat.title || chat.username || chatId),
    'Tipo: ' + (chat.type === 'channel' ? 'Canal' : 'Grupo'),
    'Solicitante: ' + requesterName,
    'Usuario: ' + username,
    'ID: ' + userId,
    bio ? 'Bio: ' + bio.slice(0, 500) : '',
    '',
    'Elige qué hacer con esta solicitud:',
  ].filter(Boolean).join('\n');

  for (const adminId of recipients) {
    if (!Number.isSafeInteger(adminId) || adminId <= 0) continue;
    try {
      const member = await api.getChatMember({ chat_id: chatId, user_id: adminId });
      if (!['creator', 'administrator'].includes(member?.status)) continue;
      await api.sendMessage({
        chat_id: adminId,
        text,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Aceptar solicitud', callback_data: 'admin:joinapprove:' + chatId + ':' + userId },
            { text: '❌ Rechazar', callback_data: 'admin:joindecline:' + chatId + ':' + userId },
          ]],
        },
      });
    } catch (error) {
      console.log('No se pudo notificar la solicitud al administrador', adminId, chatId, String(error));
    }
  }
}
