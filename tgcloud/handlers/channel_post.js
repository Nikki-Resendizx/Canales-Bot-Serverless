import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, channelRoutes } from '../schema.js';

const ALERTS_CHAT_ID = -1004424261064;
const REACTION_REPORT_CHAT_ID = -1004456932813;

export default async function (post) {
  if (!post?.chat?.id || !post?.message_id) return;
  const sourceId = Number(post.chat.id);
  const connected = await db.select().from(channels).where(eq(channels.chatId, sourceId)).get();
  if (connected && Number(connected.active) && sourceId !== ALERTS_CHAT_ID && sourceId !== REACTION_REPORT_CHAT_ID) {
    const postLink = post.chat.username
      ? `https://t.me/${post.chat.username}/${post.message_id}`
      : String(sourceId).startsWith('-100')
        ? `https://t.me/c/${String(sourceId).slice(4)}/${post.message_id}`
        : 'enlace no disponible';
    const type = post.media_group_id ? 'álbum (mensaje individual del grupo)' : post.photo ? 'foto' : post.video ? 'vídeo' : post.document ? 'documento' : post.text ? 'texto/enlace' : 'publicación';
    try {
      await api.sendMessage({
        chat_id: ALERTS_CHAT_ID,
        text: [
          '📣 NUEVA PUBLICACIÓN EN CANAL CONECTADO',
          `Canal: ${post.chat.title ?? post.chat.username ?? sourceId}`,
          `Tipo: ${type}`,
          `Publicación: ${postLink}`,
        ].join('\n'),
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.log('No se pudo enviar el aviso de publicación', String(error));
    }
  }

  const routes = await db.select().from(channelRoutes).where(eq(channelRoutes.sourceChatId, sourceId)).all();
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
