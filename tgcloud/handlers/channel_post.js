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
      await api.copyMessage({
        chat_id: route.destinationChatId,
        from_chat_id: post.chat.id,
        message_id: post.message_id,
      });
    } catch (error) {
      // No bloquear otras rutas si un destino rechaza la copia.
      console.log('No se pudo copiar la publicación a la ruta', route.routeKey, String(error));
    }
  }
}
