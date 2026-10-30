import { db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, joinRequests } from '../schema.js';

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

  // Sin mensajes privados ni avisos: las solicitudes solo se acumulan
  // y se consultan manualmente desde 📥 SOLICITUDES DE INGRESO.
}
