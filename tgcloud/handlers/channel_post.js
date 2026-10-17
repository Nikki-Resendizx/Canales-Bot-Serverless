import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, channelRoutes, postAlertKeys } from '../schema.js';

const ALERTS_CHAT_ID = -1004424261064;
const REACTION_REPORT_CHAT_ID = -1004456932813;

export default async function (post) {
  if (!post?.chat?.id || !post?.message_id) return;
  const sourceId = Number(post.chat.id);
  const connected = await db.select().from(channels).where(eq(channels.chatId, sourceId)).get();

  // En un entorno serverless no asumimos estado en memoria ni ejecutamos rutas
  // de canales que no estén registrados y activos en la base de datos.
  if (!connected || !Number(connected.active)) return;

  if (sourceId !== ALERTS_CHAT_ID && sourceId !== REACTION_REPORT_CHAT_ID) {
    // Una clave persistente por álbum evita un aviso por cada elemento del grupo.
    const alertKey = post.media_group_id
      ? `album:${sourceId}:${post.media_group_id}`
      : `post:${sourceId}:${post.message_id}`;
    let shouldAlert = false;

    try {
      const existingAlert = await db.select().from(postAlertKeys)
        .where(eq(postAlertKeys.alertKey, alertKey)).get();
      if (!existingAlert) {
        await db.insert(postAlertKeys).values({ alertKey, createdAt: Date.now() }).run();
        shouldAlert = true;
      }
    } catch (error) {
      // Si no podemos confirmar la clave, omitimos el aviso para evitar duplicados.
      console.log('No se pudo registrar la clave del aviso; se omite', String(error));
    }

    if (shouldAlert) {
      const postLink = post.chat.username
        ? `https://t.me/${post.chat.username}/${post.message_id}`
        : String(sourceId).startsWith('-100')
          ? `https://t.me/c/${String(sourceId).slice(4)}/${post.message_id}`
          : 'enlace no disponible';
      const type = post.media_group_id ? 'álbum' : post.photo ? 'foto' : post.video ? 'vídeo' : post.document ? 'documento' : post.text ? 'texto/enlace' : 'publicación';
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
  }

  const routes = await db.select().from(channelRoutes).where(eq(channelRoutes.sourceChatId, sourceId)).all();
  if (!routes?.length) return;

  // La configuración es la fuente de verdad: una ruta solo se ejecuta cuando
  // origen y destino siguen registrados y activos. Cada destino falla aislado.
  const registeredChannels = await db.select().from(channels).all();
  const channelById = new Map(registeredChannels.map(channel => [Number(channel.chatId), channel]));

  for (const route of routes) {
    const destination = channelById.get(Number(route.destinationChatId));
    if (Number(route.destinationChatId) === sourceId) continue;
    if (!destination || !Number(destination.active)) continue;
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
