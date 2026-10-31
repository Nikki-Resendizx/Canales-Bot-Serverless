import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, joinRequests, notificationTopics } from '../schema.js';

const OWNER_ID = 8624574996;

export default async function (update) {
  const chat = update?.chat;
  const user = update?.from;
  if (!chat?.id || !user?.id || !['group', 'supergroup', 'channel'].includes(chat.type)) return;

  const chatId = Number(chat.id);
  const userId = Number(user.id);
  const now = Date.now();
  const requestedAt = Number(update.date || Math.floor(now / 1000)) * 1000;
  const requestKey = chatId + ':' + userId + ':' + requestedAt;

  const existing = await db.select().from(joinRequests)
    .where(eq(joinRequests.requestKey, requestKey)).get();
  if (existing) return;

  await db.insert(joinRequests).values({
    requestKey,
    chatId,
    userId,
    requesterName: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Usuario',
    username: String(user.username || ''),
    bio: String(update.bio || ''),
    inviteLink: String(update.invite_link?.invite_link || ''),
    status: 'pending',
    requestedAt,
  }).onConflictDoNothing().run();

  // Registrar el chat para que aparezca y pueda gestionarse desde el panel.
  await db.insert(channels).values({
    chatId,
    title: String(chat.title || chat.username || chatId),
    addedBy: OWNER_ID,
    active: 1,
    createdAt: now,
  }).onConflictDoNothing().run();

  // Aviso central en el tema SOLICITUDES, sin enviar mensajes privados.
  try {
    const destination = await db.select().from(notificationTopics)
      .where(eq(notificationTopics.topicKey, 'requests')).get();
    if (destination?.chatId && destination?.messageThreadId) {
      const displayUser = user.username ? '@' + user.username : String(userId);
      const requestText = [
        '📥 SOLICITUD DE INGRESO',
        '',
        'DESTINO: ' + String(chat.title || chatId),
        'TIPO: ' + String(chat.type || ''),
        'SOLICITANTE: ' + String([user.first_name, user.last_name].filter(Boolean).join(' ') || 'Usuario'),
        'USUARIO: ' + displayUser,
        'ID: ' + userId,
        'REGISTRO: ' + new Date(requestedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        'ENLACE DE: ' + String(update.invite_link?.invite_link || 'No disponible'),
        'MIEMBRO EN: No calculado',
      ].join('\n');
      await api.sendMessage({
        chat_id: Number(destination.chatId),
        message_thread_id: Number(destination.messageThreadId),
        text: requestText,
      });
    }
  } catch (error) {
    console.log('No se pudo enviar la solicitud al tema central de notificaciones', String(error));
  }
}
