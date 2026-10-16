import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { globalBans } from '../schema.js';

export default async function (update) {
  const chat = update?.chat;
  const member = update?.new_chat_member;
  const user = member?.user;
  if (!chat?.id || !user?.id || user.is_bot) return;

  // Solo actuar cuando la persona entra o vuelve a ser miembro.
  if (!['member', 'restricted'].includes(member.status)) return;
  const banned = await db.select().from(globalBans).where(eq(globalBans.userId, user.id)).get();
  if (!banned) return;

  // Baneo permanente en este canal/grupo. El bot necesita permisos de administrador.
  await api.banChatMember({
    chat_id: chat.id,
    user_id: user.id,
    revoke_messages: true,
  });
}
