import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channelRoutes } from '../schema.js';

export default async function (post) {
  if (!post?.chat?.id || !post?.message_id) return;
  const routes = await db.select().from(channelRoutes).where(eq(channelRoutes.sourceChatId, post.chat.id)).all();
  if (!routes?.length) return;

  for (const route of routes) {
    if (Number(route.destinationChatId) === Number(post.chat.id)) continue;
    try {
      if (post.forward_origin || post.forward_from || post.forward_from_chat || post.forward_sender_name) {
        await api.forwardMessage({
          chat_id: route.destinationChatId,
          from_chat_id: post.chat.id,
          message_id: post.message_id,
        });
      } else {
        await api.copyMessage({
          chat_id: route.destinationChatId,
          from_chat_id: post.chat.id,
          message_id: post.message_id,
        });
      }
    } catch (error) {
      // No bloquear otras rutas si un destino rechaza la copia.
      console.log('No se pudo copiar la publicación a la ruta', route.routeKey, String(error));
    }
  }
}
