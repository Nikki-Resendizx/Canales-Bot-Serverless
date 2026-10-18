import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, channelRoutes, channelSettings, templates, postAlertKeys } from '../schema.js';

const ALERTS_CHAT_ID = -1004424261064;
const REACTION_REPORT_CHAT_ID = -1004456932813;


function publicationKind(post) {
  // Los reenvíos tienen su propia plantilla aunque incluyan texto o multimedia.
  if (post.forward_origin || post.forward_from || post.forward_from_chat || post.forward_sender_name) return 'forward';
  if (post.media_group_id) return 'album';
  if (post.photo) return 'photo';
  if (post.animation) return 'gif';
  if (post.video_note) return 'video_note';
  if (post.video) return 'video';
  if (post.audio || post.voice) return 'audio';
  if (post.document) return 'document';
  // Los enlaces pueden llegar como texto o como descripción de una foto/vídeo.
  const visibleText = String(post.text ?? post.caption ?? '');
  if (/https?:\/\/|t\.me\//i.test(visibleText)) return 'link';
  return 'text';
}

function getPublicationLink(chat, messageId) {
  if (chat?.username) return 'https://t.me/' + chat.username + '/' + messageId;
  const id = String(chat?.id ?? '');
  return /^-100\d+$/.test(id) ? 'https://t.me/c/' + id.slice(4) + '/' + messageId : '';
}

function applyTemplate(template, values) {
  let result = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp('\\{' + key + '\\}', 'gi'), String(value ?? ''));
  }
  return result.trim();
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;');
}

function resolveFormat(format, body = '') {
  const selected = String(format ?? 'OFF').toUpperCase();
  if (selected !== 'AUTO') return selected;
  const source = String(body ?? '');
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        (typeof parsed.html === 'string' || typeof parsed.markdown === 'string' || Array.isArray(parsed.blocks))) {
      return 'RICH_MESSAGE';
    }
  } catch {}
  if (/<\/?(?:b|i|u|s|strong|em|a|code|pre|tg-spoiler)\b/i.test(source)) return 'HTML';
  if (source.includes('\\_') || source.includes('\\.') || source.includes('\\!') || source.includes('\\-')) return 'MARKDOWNV2';
  if (/\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|_[^_]+_|\*[^*]+\*/.test(source)) return 'MARKDOWN';
  return 'OFF';
}

function parseMode(format) {
  const value = String(format ?? 'HTML').toUpperCase();
  if (value === 'HTML') return 'HTML';
  if (value === 'MARKDOWN') return 'Markdown';
  if (value === 'MARKDOWNV2') return 'MarkdownV2';
  return undefined;
}

function appendHashtags(text, configured) {
  const tags = String(configured ?? '').match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (!tags.length) return String(text ?? '');
  let result = String(text ?? '').trim();
  const existing = new Set((result.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(tag => tag.toLocaleLowerCase('es-MX')));
  const missing = tags.filter((tag, index) =>
    !existing.has(tag.toLocaleLowerCase('es-MX')) &&
    tags.findIndex(other => other.toLocaleLowerCase('es-MX') === tag.toLocaleLowerCase('es-MX')) === index
  );
  if (missing.length) result = [result, missing.join(' ')].filter(Boolean).join('\n\n');
  return result;
}

async function completeManualPublication(post, channelId) {
  const settings = await db.select().from(channelSettings)
    .where(eq(channelSettings.channelId, channelId)).get();
  const kind = publicationKind(post);
  const templateRows = await db.select().from(templates)
    .where(eq(templates.channelId, channelId)).all();
  const template = templateRows.find(row => row.kind === kind)
    ?? templateRows.find(row => row.kind === 'default')
    ?? null;

  // {vacio} is an explicit opt-out: do not alter the message or its keyboard.
  if (String(template?.body ?? '').includes('{vacio}')) return;

  const rawOriginal = String(post.text ?? post.caption ?? '');
  const format = resolveFormat(template?.format ?? 'OFF', template?.body);
  const corrected = Number(settings?.textCorrectionEnabled) ? rawOriginal
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,;!?])([^\s])/g, '$1 $2')
    .trim()
    .replace(/^([a-záéíóúñ])/u, char => char.toLocaleUpperCase('es-MX'))
    : rawOriginal;
  const detectedLink = corrected.match(/https?:\/\/\S+|t\.me\/\S+/i)?.[0] ?? '';
  const permalink = getPublicationLink(post.chat, post.message_id);
  const link = detectedLink || permalink;
  const date = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date());
  const channelName = String(post.chat.title ?? post.chat.username ?? channelId);
  const descriptionSource = String(settings?.descriptionTemplate ?? '');
  const values = {
    contenido: rawOriginal,
    texto: corrected,
    titulo: rawOriginal.split('\n')[0] ?? '',
    descripcion: rawOriginal,
    enlace: link,
    hashtags: String(settings?.hashtags ?? '').trim(),
    fecha: date,
    canal: channelName,
  };
  if (descriptionSource) values.descripcion = applyTemplate(descriptionSource, { ...values, contenido: rawOriginal, texto: corrected, descripcion: rawOriginal });
  if (format === 'HTML') {
    values.enlace = escapeHtml(values.enlace);
    values.contenido = escapeHtml(values.contenido);
    values.texto = escapeHtml(values.texto);
    values.titulo = escapeHtml(values.titulo);
    values.descripcion = escapeHtml(values.descripcion);
    values.hashtags = escapeHtml(values.hashtags);
    values.canal = escapeHtml(values.canal);
  }

  let output = template?.body ? applyTemplate(template.body, values) : corrected;
  if (!output && settings?.missingDataText) output = applyTemplate(settings.missingDataText, values);
  if (settings?.hashtags && !String(template?.body ?? '').includes('{hashtags}')) {
    output = appendHashtags(output, settings.hashtags);
  }

  let buttons = [];
  try {
    const parsed = JSON.parse(template?.buttonsJson || '[]');
    if (Array.isArray(parsed)) buttons = parsed;
  } catch (error) {
    console.log('Botones inválidos en plantilla del canal', channelId, kind, String(error));
  }

  const hasText = typeof post.text === 'string';
  const hasCaption = typeof post.caption === 'string';
  const isMedia = Boolean(post.photo || post.video || post.animation || post.document || post.audio || post.voice || post.video_note);
  const canEditContent = !post.video_note && (!post.media_group_id || hasCaption || hasText);
  const canAddButtons = !post.media_group_id || hasCaption || hasText;
  const replyMarkup = buttons.length && canAddButtons ? { inline_keyboard: buttons } : undefined;

  if (format === 'RICH_MESSAGE' && template?.body && canEditContent) {
    try {
      const richMessage = JSON.parse(template.body);
      const replaceRich = value => {
        if (typeof value === 'string') return applyTemplate(value, values);
        if (Array.isArray(value)) return value.map(replaceRich);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceRich(item)]));
        return value;
      };
      const rich = replaceRich(richMessage);
      if (!isMedia && rich && typeof rich === 'object' &&
          (typeof rich.html === 'string' || typeof rich.markdown === 'string' || Array.isArray(rich.blocks))) {
        await api.editMessageText({
          chat_id: channelId, message_id: post.message_id,
          rich_message: rich,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        return;
      }
      // Captions do not accept a full RichMessage block tree; use a supported text field only.
      const richText = typeof rich?.html === 'string' ? rich.html : typeof rich?.markdown === 'string' ? rich.markdown : '';
      if (isMedia && richText) {
        await api.editMessageCaption({
          chat_id: channelId, message_id: post.message_id, caption: richText,
          ...(typeof rich?.html === 'string' ? { parse_mode: 'HTML' } : {}),
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        return;
      }
      console.log('RICH_MESSAGE necesita html, markdown o blocks; en captions solo se admiten html/markdown', channelId, post.message_id);
    } catch (error) {
      console.log('No se pudo aplicar RICH_MESSAGE a la publicación manual', channelId, post.message_id, String(error));
    }
  }
  if (format === 'RICH_MESSAGE') {
    // Never fall through and replace the post with the raw JSON if rich editing fails.
    if (replyMarkup) {
      try { await api.editMessageReplyMarkup({ chat_id: channelId, message_id: post.message_id, reply_markup: replyMarkup }); }
      catch (error) { console.log('No se pudieron añadir botones tras un fallo de RICH_MESSAGE', channelId, post.message_id, String(error)); }
    }
    return;
  }

  const mode = parseMode(format);
  const contentChanged = canEditContent && output !== rawOriginal && Boolean(output);
  if (contentChanged) {
    const args = {
      chat_id: channelId,
      message_id: post.message_id,
      [isMedia ? 'caption' : 'text']: output,
      ...(mode ? { parse_mode: mode } : {}),
      ...(!mode && rawOriginal && output.startsWith(rawOriginal)
        ? (isMedia
          ? (Array.isArray(post.caption_entities) ? { caption_entities: post.caption_entities } : {})
          : (Array.isArray(post.entities) ? { entities: post.entities } : {}))
        : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    };
    try {
      if (isMedia) await api.editMessageCaption(args);
      else await api.editMessageText(args);
      return;
    } catch (error) {
      console.log('No se pudo aplicar la plantilla al mensaje manual', channelId, post.message_id, String(error));
    }
  }

  if (replyMarkup) {
    try {
      await api.editMessageReplyMarkup({
        chat_id: channelId,
        message_id: post.message_id,
        reply_markup: replyMarkup,
      });
    } catch (error) {
      console.log('No se pudieron añadir los botones a la publicación manual', channelId, post.message_id, String(error));
    }
  }
}

export default async function (post) {
  if (!post?.chat?.id || !post?.message_id) return;
  const sourceId = Number(post.chat.id);
  const connected = await db.select().from(channels).where(eq(channels.chatId, sourceId)).get();

  // En un entorno serverless no asumimos estado en memoria ni ejecutamos rutas
  // de canales que no estén registrados y activos en la base de datos.
  if (!connected || !Number(connected.active)) return;

  // Función principal: completar la publicación manual con los ajustes de este canal.
  try {
    await completeManualPublication(post, sourceId);
  } catch (error) {
    console.log('No se pudo completar automáticamente la publicación', sourceId, post.message_id, String(error));
  }

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
