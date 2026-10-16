import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import {
  admins, channels, channelSettings, globalBans, channelRoutes,
  templates, publications, purchases, reactionReports, knownUsers, botTexts,
} from '../schema.js';

const OWNER_ID = 8624574996;
const DEFAULT_REACTION_REPORT_CHAT_ID = -1004456932813;
const now = () => Date.now();
const parseId = value => /^-?\d+$/.test(String(value ?? '')) ? Number(value) : NaN;
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function correctText(value) {
  return String(value ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,;!?])([^\s])/g, '$1 $2')
    .trim()
    .replace(/^([a-záéíóúñ])/u, char => char.toLocaleUpperCase('es-MX'));
}

async function isAdmin(userId) {
  if (Number(userId) === OWNER_ID) return true;
  return Boolean(await db.select().from(admins).where(eq(admins.userId, Number(userId))).get());
}
async function canManageChannel(userId, channelId) {
  const channel = await db.select().from(channels).where(eq(channels.chatId, Number(channelId))).get();
  return Boolean(channel && (Number(userId) === OWNER_ID || Number(channel.addedBy) === Number(userId)));
}
async function managedChannels(userId) {
  const rows = await db.select().from(channels).all();
  return Number(userId) === OWNER_ID ? rows : rows.filter(row => Number(row.addedBy) === Number(userId));
}
async function say(chatId, text, extra = {}) {
  return api.sendMessage({ chat_id: chatId, text, ...extra });
}
async function ensureSettings(channelId) {
  let row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
  if (!row) {
    await db.insert(channelSettings).values({
      channelId, welcomeEnabled: 0, welcomeText: '👋 ¡Bienvenido, {mencion}!',
      captchaEnabled: 0, captchaQuestion: '', captchaAnswer: '', reactionReportChatId: DEFAULT_REACTION_REPORT_CHAT_ID, updatedAt: now(),
    }).run();
    row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
  } else if (!row.reactionReportChatId) {
    await db.update(channelSettings).set({ reactionReportChatId: DEFAULT_REACTION_REPORT_CHAT_ID, updatedAt: now() }).where(eq(channelSettings.channelId, channelId)).run();
    row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
  }
  return row;
}
const NAV_DEFAULTS = {
  panel_title: '⚙️ PANEL DE ADMINISTRACIÓN',
  panel_description: 'Selecciona una sección:',
  channels: '📢 CANALES', welcome: '👋 BIENVENIDA', captcha: '🧩 CAPTCHA',
  blacklist: '🚫 BANEO GLOBAL', routes: '🔀 DISTRIBUCIÓN', templates: '📝 PLANTILLAS',
  publications: '📝 CREAR PUBLICACIÓN', buttons: '🔘 BOTONES', formats: '🎨 FORMATOS',
  reactions: '🔔 REACCIONES', stars: '⭐ PREMIUM / ESTRELLAS', admins: '👥 ADMINISTRADORES',
  stats: '📊 ESTADÍSTICAS', settings: '⚙️ CONFIGURACIÓN', close: '❌ CERRAR', navigation: '🧭 NAVEGACIÓN',
  back: '🔙 VOLVER',
};
async function navText(key) {
  // El menú principal debe poder abrirse incluso si la migración de bot_texts aún no terminó.
  try {
    const row = await db.select().from(botTexts).where(eq(botTexts.textKey, key)).get();
    return row?.body || NAV_DEFAULTS[key] || key;
  } catch (error) {
    console.log('No se pudieron leer los textos de navegación; se usarán valores predeterminados', String(error));
    return NAV_DEFAULTS[key] || key;
  }
}
async function buildMainMenu() {
  const keys = [
    ['channels', 'templates', 'formats'],
    ['buttons', 'publications', 'stars'],
    ['welcome', 'captcha', 'blacklist'],
    ['routes', 'reactions', 'stats'],
    ['admins', 'settings', 'navigation'],
    ['close'],
  ];
  const menu = [];
  for (const row of keys) {
    const buttons = [];
    for (const key of row) buttons.push({ text: await navText(key), callback_data: key === 'close' ? 'admin:close' : 'admin:' + key });
    menu.push(buttons);
  }
  return menu;
}

const HELP = [
  '📚 COMANDOS DE CHANNELPOSTS_ROBOT',
  '/admin — panel privado de administración',
  '/channels — listar canales',
  '/addchannel ID [título] — registrar canal',
  '/delchannel ID — quitar canal',
  '/welcome ID on|off — bienvenida por canal',
  '/welcometext ID texto — editar bienvenida',
  '/captcha ID on|off — CAPTCHA por canal',
  '/correction ID on|off — corrección básica del texto',
  '/hashtags ID texto — hashtags por canal',
  '/description ID texto — plantilla de descripción con {texto}',
  '/missingdata ID texto — texto de respaldo si falta el contenido',
  '/setreport ID_CANAL ID_REPORTE — destino de avisos de reacción',
  '/blacklist_add ID|@username [motivo] — blacklist y baneo global',
  '/blacklist_remove ID|@username — retirar blacklist y desbanear',
  '/globalban ID|@username [motivo] y /globalunban ID|@username — moderación global',
  '/blacklist — consultar blacklist',
  '/route_add ORIGEN DESTINO — crear ruta',
  '/route_remove ORIGEN DESTINO — borrar ruta',
  '/routes — listar rutas',
  '/template_set ID_CANAL TIPO FORMATO texto — crear/editar plantilla',
  '/template_list ID_CANAL — listar plantillas',
  '/template_buttons ID_CANAL TIPO JSON — configurar botones inline',
  '/template_delete ID_CANAL TIPO — borrar plantilla',
  '/publish ID_CANAL texto — publicar texto',
  '/publish_paid ID_CANAL PRECIO_STARS texto — crear publicación de pago en Stars, o responder a un mensaje multimedia',
  'Responde a un mensaje con /publish ID_CANAL para copiarlo al canal.',
  '/navtexts y /navtext CLAVE texto — editar textos de navegación',
  '/stats — estadísticas',
  '/addadmin ID y /deladmin ID — solo propietario',
  '',
  'Formatos: HTML, Markdown, MarkdownV2, OFF y RICH_MESSAGE (JSON válido).',
  'Variables de bienvenida: {mencion}, {nombre}, {username}, {userid}.',
  'El bot debe tener permisos de administrador en cada canal/grupo.',
].join('\n');

export default async function (message) {
  if (!message?.chat?.id || !message?.from) return;
  const chatId = Number(message.chat.id);
  const userId = Number(message.from.id);
  const text = String(message.text ?? '').trim();
  const isPrivate = chatId === userId;
  if (!message.from.is_bot && Number.isSafeInteger(userId) && userId > 0) {
    try {
      const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ');
      await db.insert(knownUsers).values({
        userId,
        username: String(message.from.username ?? '').toLowerCase(),
        displayName,
        lastSeenAt: now(),
      }).onConflictDoUpdate({
        target: knownUsers.userId,
        set: {
          username: String(message.from.username ?? '').toLowerCase(),
          displayName,
          lastSeenAt: now(),
        },
      }).run();
    } catch (error) {
      console.log('No se pudo actualizar el registro de usuario conocido', String(error));
    }
  }

  if (message.chat_shared) {
    if (!isPrivate || !(await isAdmin(userId))) {
      await say(chatId, '⛔ Solo un administrador autorizado puede conectar canales desde el panel.');
      return;
    }
    const sharedChatId = Number(message.chat_shared.chat_id);
    await say(chatId,
      Number.isSafeInteger(sharedChatId)
        ? '📨 Selección recibida para el canal ' + sharedChatId + '. Telegram confirmará la incorporación del bot como administrador y lo registrará automáticamente. Si no aparece en la lista, comprueba que aceptaste agregarlo como administrador.'
        : '⚠️ Telegram no devolvió un ID de canal válido.',
      { reply_markup: { remove_keyboard: true } }
    );
    return;
  }

  if (message.successful_payment) {
    const payment = message.successful_payment;
    const publicationKey = String(payment.invoice_payload ?? '');
    const publication = await db.select().from(publications).where(eq(publications.publicationKey, publicationKey)).get();
    if (!publication || publication.status !== 'paid' || payment.currency !== 'XTR' || Number(payment.total_amount) !== Number(publication.starsPrice)) {
      await say(chatId, '⚠️ El pago llegó, pero no pude validar la publicación. Contacta al administrador con el ID de pago: ' + String(payment.telegram_payment_charge_id ?? 'no disponible'));
      return;
    }
    const purchaseKey = `${publicationKey}:${userId}`;
    const previous = await db.select().from(purchases).where(eq(purchases.purchaseKey, purchaseKey)).get();
    if (previous?.status === 'paid') {
      await say(chatId, '✅ Este pago ya estaba registrado. Si no recibiste el contenido, contacta al administrador.');
      return;
    }
    await db.insert(purchases).values({
      purchaseKey, publicationKey, buyerId: userId,
      telegramChargeId: String(payment.telegram_payment_charge_id ?? ''),
      providerChargeId: String(payment.provider_payment_charge_id ?? ''),
      status: 'paid', createdAt: now(), updatedAt: now(),
    }).onConflictDoUpdate({
      target: purchases.purchaseKey,
      set: {
        telegramChargeId: String(payment.telegram_payment_charge_id ?? ''),
        providerChargeId: String(payment.provider_payment_charge_id ?? ''),
        status: 'paid', updatedAt: now(),
      },
    }).run();
    let paidContent = {};
    try { paidContent = JSON.parse(publication.payloadJson || '{}'); } catch { paidContent = {}; }
    if (paidContent.type === 'copy' && Number.isSafeInteger(Number(paidContent.sourceChatId)) && Number.isSafeInteger(Number(paidContent.sourceMessageId))) {
      await api.copyMessage({ chat_id: userId, from_chat_id: Number(paidContent.sourceChatId), message_id: Number(paidContent.sourceMessageId) });
    } else if (paidContent.type === 'text' && typeof paidContent.text === 'string') {
      await say(chatId, '💎 CONTENIDO DESBLOQUEADO\n\n' + paidContent.text);
    } else {
      await say(chatId, '✅ Pago confirmado. El contenido requiere revisión del administrador; conserva este mensaje como comprobante.');
    }
    return;
  }

  if (text === '/start' || text.startsWith('/start ')) {
    const startPayload = text.split(/\\s+/)[1] || '';
    if (startPayload.startsWith('buy_')) {
      if (!isPrivate) {
        await say(chatId, 'Abre el enlace en el chat privado del bot para comprar esta publicación.');
        return;
      }
      const publicationKey = startPayload.slice(4);
      const publication = await db.select().from(publications).where(eq(publications.publicationKey, publicationKey)).get();
      if (!publication || publication.status !== 'paid' || Number(publication.starsPrice) < 1) {
        await say(chatId, '⛔ Esta publicación de pago no está disponible.');
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: 'Acceso a publicación',
        description: 'Desbloquea el contenido exclusivo de CANALES-BOT.',
        payload: publicationKey,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'Acceso', amount: Number(publication.starsPrice) }],
        start_parameter: startPayload,
      });
      return;
    }
    await say(chatId, '👋 ¡Bienvenido a CANALES-BOT!\n\nGestiona canales, publicaciones, plantillas, botones, bienvenida, CAPTCHA, blacklist, rutas y reportes de reacciones. Usa /help para ver los comandos.', {
      reply_markup: { inline_keyboard: [[{ text: '⚙️ PANEL DE ADMINISTRACIÓN', callback_data: 'admin:open' }], [{ text: '📚 Ayuda', callback_data: 'admin:help' }]] },
    });
    return;
  }
  if (text === '/help') {
    await say(chatId, HELP);
    return;
  }
  if (text === '/admin') {
    if (!isPrivate || !(await isAdmin(userId))) {
      await say(chatId, '⛔ El panel solo está disponible para administradores autorizados en chat privado.');
      return;
    }
    await say(chatId, (await navText('panel_title')) + '\nCANALES-BOT\n\n' + (await navText('panel_description')), {
      reply_markup: { inline_keyboard: await buildMainMenu() },
    });
    return;
  }

  if (!text.startsWith('/')) return;
  if (!(await isAdmin(userId))) {
    if (isPrivate) await say(chatId, '⛔ No tienes autorización para usar comandos administrativos.');
    return;
  }
  if (!isPrivate) {
    await say(chatId, '🔒 Ejecuta los comandos administrativos en el chat privado del bot.');
    return;
  }

  const [commandRaw, ...args] = text.split(/\s+/);
  const command = commandRaw.split('@')[0].toLowerCase();
  const argText = text.slice(commandRaw.length).trim();
  try {
    if (command === '/channels') {
      const rows = await managedChannels(userId);
      await say(chatId, rows.length ? '📣 CANALES REGISTRADOS\n' + rows.map(c => `• ${c.title || 'Sin título'} — ${c.chatId} — ${c.active ? 'activo' : 'inactivo'}`).join('\n') : 'No hay canales registrados. Usa /addchannel ID título.');
      return;
    }
    if (command === '/addchannel') {
      const forwarded = message.reply_to_message ?? message;
      const forwardSource = forwarded.forward_from_chat ?? forwarded.forward_origin?.chat ?? null;
      let id = parseId(args[0]);
      let title = '';
      if (!Number.isSafeInteger(id) || id === 0) {
        if (!Number.isSafeInteger(Number(forwardSource?.id)) || forwardSource?.type !== 'channel') {
          return void await say(chatId, 'Uso: /addchannel ID [título]. También puedes reenviar una publicación del canal al bot y responder a ella con /addchannel [título] para detectar su ID.');
        }
        id = Number(forwardSource.id);
        title = args.join(' ') || String(forwardSource.title ?? id);
      } else {
        title = args.slice(1).join(' ') || String(id);
      }
      await db.insert(channels).values({ chatId: id, title, addedBy: userId, active: 1, createdAt: now() })
        .onConflictDoUpdate({ target: channels.chatId, set: { title, active: 1 } }).run();
      await ensureSettings(id);
      await say(chatId, `✅ Canal registrado: ${title} (${id}). Añade el bot como administrador y concede los permisos requeridos.`);
      return;
    }
    if (command === '/delchannel') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /delchannel ID');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await db.delete(channels).where(eq(channels.chatId, id)).run();
      await db.delete(channelSettings).where(eq(channelSettings.channelId, id)).run();
      await db.delete(channelRoutes).where(eq(channelRoutes.sourceChatId, id)).run();
      await db.delete(channelRoutes).where(eq(channelRoutes.destinationChatId, id)).run();
      await say(chatId, `✅ Canal ${id} eliminado junto con su configuración y rutas asociadas.`);
      return;
    }
    if (command === '/welcome') {
      const id = parseId(args[0]); const mode = String(args[1] || '').toLowerCase();
      if (!Number.isSafeInteger(id) || !['on', 'off'].includes(mode)) return void await say(chatId, 'Uso: /welcome ID on|off');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await ensureSettings(id);
      await db.update(channelSettings).set({ welcomeEnabled: mode === 'on' ? 1 : 0, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, `✅ Bienvenida ${mode === 'on' ? 'activada' : 'desactivada'} para ${id}.`);
      return;
    }
    if (command === '/welcometext') {
      const id = parseId(args[0]); const body = argText.slice(String(args[0] ?? '').length).trim();
      if (!Number.isSafeInteger(id) || !body) return void await say(chatId, 'Uso: /welcometext ID texto. Variables: {mencion}, {nombre}, {username}, {userid}.');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await ensureSettings(id);
      await db.update(channelSettings).set({ welcomeText: body, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, '✅ Texto de bienvenida guardado.');
      return;
    }
    if (command === '/captcha') {
      const id = parseId(args[0]); const mode = String(args[1] || '').toLowerCase();
      if (!Number.isSafeInteger(id) || !['on', 'off'].includes(mode)) return void await say(chatId, 'Uso: /captcha ID on|off');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await ensureSettings(id);
      await db.update(channelSettings).set({ captchaEnabled: mode === 'on' ? 1 : 0, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, `✅ CAPTCHA ${mode === 'on' ? 'activado' : 'desactivado'} para ${id}. El fallo o vencimiento aplica baneo permanente.`);
      return;
    }
    if (command === '/setreport') {
      const id = parseId(args[0]); const reportId = parseId(args[1]);
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(reportId)) return void await say(chatId, 'Uso: /setreport ID_CANAL ID_REPORTE');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await ensureSettings(id);
      await db.update(channelSettings).set({ reactionReportChatId: reportId, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, '✅ Canal de reportes configurado. El bot debe poder publicar allí.');
      return;
    }
    if (command === '/correction') {
      const id = parseId(args[0]); const mode = String(args[1] || '').toLowerCase();
      if (!Number.isSafeInteger(id) || !['on', 'off'].includes(mode)) return void await say(chatId, 'Uso: /correction ID_CANAL on|off');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await ensureSettings(id);
      await db.update(channelSettings).set({ textCorrectionEnabled: mode === 'on' ? 1 : 0, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, `✅ Corrección básica de texto ${mode === 'on' ? 'activada' : 'desactivada'} para ${id}.`);
      return;
    }
    if (command === '/hashtags' || command === '/description' || command === '/missingdata') {
      const id = parseId(args[0]); const value = argText.slice(String(args[0] ?? '').length).trim();
      if (!Number.isSafeInteger(id) || !value) return void await say(chatId, `Uso: ${command} ID_CANAL texto`);
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      if (value.length > 1000) return void await say(chatId, 'El texto supera el límite de 1000 caracteres.');
      await ensureSettings(id);
      const column = command === '/hashtags' ? 'hashtags' : command === '/description' ? 'descriptionTemplate' : 'missingDataText';
      await db.update(channelSettings).set({ [column]: value, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      const label = command === '/hashtags' ? 'Hashtags' : command === '/description' ? 'Plantilla de descripción' : 'Texto de respaldo para datos faltantes';
      await say(chatId, `✅ ${label} guardado para el canal ${id}. En descripción puedes usar {texto}.`);
      return;
    }
    if (command === '/blacklist_add' || command === '/globalban') {
      let id = parseId(args[0]);
      let username = '';
      let reason = '';
      if (!Number.isSafeInteger(id) && String(args[0] ?? '').startsWith('@')) {
        username = String(args[0]).slice(1).toLowerCase();
        const known = await db.select().from(knownUsers).where(eq(knownUsers.username, username)).get();
        id = Number(known?.userId);
        reason = args.slice(1).join(' ') || 'Sin motivo especificado';
      } else {
        username = args[1]?.startsWith('@') ? args[1].slice(1).toLowerCase() : '';
        reason = args.slice(username ? 2 : 1).join(' ') || 'Sin motivo especificado';
        if (!username && Number.isSafeInteger(id)) {
          const known = await db.select().from(knownUsers).where(eq(knownUsers.userId, id)).get();
          username = String(known?.username ?? '');
        }
      }
      if (!Number.isSafeInteger(id) || id <= 0) return void await say(chatId, 'Uso: /blacklist_add ID|@username [motivo]. Para usar @username, el usuario debe haber interactuado con el bot o aparecer en un evento que el bot haya recibido.');
      await db.insert(globalBans).values({ userId: id, username, reason, bannedBy: userId, createdAt: now() })
        .onConflictDoUpdate({ target: globalBans.userId, set: { username, reason, bannedBy: userId, createdAt: now() } }).run();
      const rows = await managedChannels(userId);
      let bannedCount = 0;
      for (const channel of rows) {
        try {
          const actor = await api.getChatMember({ chat_id: channel.chatId, user_id: userId });
          if (!['creator', 'administrator'].includes(actor.status)) continue;
          await api.banChatMember({ chat_id: channel.chatId, user_id: id, revoke_messages: true });
          bannedCount += 1;
        } catch (error) {
          console.log('No se pudo aplicar baneo global en', channel.chatId, String(error));
        }
      }
      await say(chatId, `🚫 Usuario ${id}${username ? ' (@' + username + ')' : ''} añadido a la blacklist. Baneo aplicado en ${bannedCount}/${rows.length} chats conectados; también se bloqueará si intenta entrar de nuevo donde el bot tenga permisos.`);
      return;
    }
    if (command === '/blacklist_remove' || command === '/globalunban') {
      let id = parseId(args[0]);
      if (!Number.isSafeInteger(id) && String(args[0] ?? '').startsWith('@')) {
        const username = String(args[0]).slice(1).toLowerCase();
        const known = await db.select().from(knownUsers).where(eq(knownUsers.username, username)).get();
        id = Number(known?.userId);
      }
      if (!Number.isSafeInteger(id) || id <= 0) return void await say(chatId, 'Uso: /blacklist_remove ID|@username');
      await db.delete(globalBans).where(eq(globalBans.userId, id)).run();
      const rows = await managedChannels(userId);
      let unbannedCount = 0;
      for (const channel of rows) {
        try {
          const actor = await api.getChatMember({ chat_id: channel.chatId, user_id: userId });
          if (!['creator', 'administrator'].includes(actor.status)) continue;
          await api.unbanChatMember({ chat_id: channel.chatId, user_id: id, only_if_banned: true });
          unbannedCount += 1;
        } catch (error) {
          console.log('No se pudo aplicar desbaneo global en', channel.chatId, String(error));
        }
      }
      await say(chatId, `✅ Usuario ${id} eliminado de la blacklist; desbaneo solicitado en ${unbannedCount}/${rows.length} chats conectados.`);
      return;
    }
    if (command === '/blacklist') {
      const rows = await db.select().from(globalBans).all();
      await say(chatId, rows.length ? '🚫 BLACKLIST GLOBAL\n' + rows.map(b => `• ${b.userId} ${b.username ? '@' + b.username : ''} — ${b.reason}`).join('\n') : 'La blacklist está vacía.');
      return;
    }
    if (command === '/route_add') {
      const source = parseId(args[0]); const destination = parseId(args[1]);
      if (!Number.isSafeInteger(source) || !Number.isSafeInteger(destination) || source === destination) return void await say(chatId, 'Uso: /route_add ORIGEN DESTINO (IDs distintos).');
      const sourceRow = await db.select().from(channels).where(eq(channels.chatId, source)).get();
      const destinationRow = await db.select().from(channels).where(eq(channels.chatId, destination)).get();
      if (!sourceRow || !destinationRow) return void await say(chatId, 'Registra primero ambos canales con /addchannel ID título.');
      if (!(await canManageChannel(userId, source)) || !(await canManageChannel(userId, destination))) return void await say(chatId, '⛔ Solo puedes crear rutas entre canales de tu administración.');
      const routeKey = `${source}:${destination}`;
      await db.insert(channelRoutes).values({ routeKey, sourceChatId: source, destinationChatId: destination, createdBy: userId, createdAt: now() })
        .onConflictDoUpdate({ target: channelRoutes.routeKey, set: { sourceChatId: source, destinationChatId: destination, createdBy: userId, createdAt: now() } }).run();
      await say(chatId, `✅ Ruta creada: ${source} → ${destination}. El bot debe ser administrador en ambos canales.`);
      return;
    }
    if (command === '/route_remove') {
      const source = parseId(args[0]); const destination = parseId(args[1]);
      if (!Number.isSafeInteger(source) || !Number.isSafeInteger(destination)) return void await say(chatId, 'Uso: /route_remove ORIGEN DESTINO');
      if (!(await canManageChannel(userId, source)) || !(await canManageChannel(userId, destination))) return void await say(chatId, '⛔ Solo puedes eliminar rutas entre canales de tu administración.');
      await db.delete(channelRoutes).where(eq(channelRoutes.routeKey, `${source}:${destination}`)).run();
      await say(chatId, '✅ Ruta eliminada.');
      return;
    }
    if (command === '/routes') {
      const allRoutes = await db.select().from(channelRoutes).all();
      const rows = [];
      for (const route of allRoutes) if (await canManageChannel(userId, route.sourceChatId) && await canManageChannel(userId, route.destinationChatId)) rows.push(route);
      await say(chatId, rows.length ? '🔀 RUTAS ACTIVAS\n' + rows.map(r => `• ${r.sourceChatId} → ${r.destinationChatId}`).join('\n') : 'No hay rutas configuradas.');
      return;
    }
    if (command === '/navtexts') {
      const rows = await db.select().from(botTexts).all();
      const lines = Object.entries(NAV_DEFAULTS).map(([key, fallback]) => {
        const saved = rows.find(row => row.textKey === key);
        return `• ${key}: ${saved?.body || fallback}`;
      });
      await say(chatId, '🧭 TEXTOS DE NAVEGACIÓN EDITABLES\n\n' + lines.join('\n') + '\n\nEditar: /navtext CLAVE nuevo texto\nRestaurar una clave: /navtext CLAVE default');
      return;
    }
    if (command === '/navtext') {
      const key = String(args[0] || '');
      const value = argText.slice(key.length).trim();
      if (!Object.hasOwn(NAV_DEFAULTS, key)) return void await say(chatId, 'Clave no válida. Usa /navtexts para ver las claves disponibles.');
      if (!value) return void await say(chatId, 'Uso: /navtext CLAVE nuevo texto. Usa /navtext CLAVE default para restaurar el texto original.');
      if (value.toLowerCase() === 'default') {
        await db.delete(botTexts).where(eq(botTexts.textKey, key)).run();
        await say(chatId, `✅ Se restauró el texto original de “${key}”.`);
      } else {
        await db.insert(botTexts).values({ textKey: key, body: value, updatedBy: userId, updatedAt: now() })
          .onConflictDoUpdate({ target: botTexts.textKey, set: { body: value, updatedBy: userId, updatedAt: now() } }).run();
        await say(chatId, `✅ Texto de navegación “${key}” actualizado.`);
      }
      return;
    }
    if (command === '/template_set') {
      const id = parseId(args[0]); const kind = args[1]; const format = String(args[2] || 'HTML').toUpperCase();
      const body = argText.split(/\s+/).slice(3).join(' ');
      if (!Number.isSafeInteger(id) || !kind || !body || !['HTML', 'MARKDOWN', 'MARKDOWNV2', 'OFF', 'RICH_MESSAGE'].includes(format)) return void await say(chatId, 'Uso: /template_set ID_CANAL TIPO HTML|Markdown|MarkdownV2|OFF|RICH_MESSAGE texto. RICH_MESSAGE requiere JSON válido.');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      const templateKey = `${id}:${kind}`;
      await db.insert(templates).values({ templateKey, channelId: id, kind, body, format, buttonsJson: '[]', updatedBy: userId, updatedAt: now() })
        .onConflictDoUpdate({ target: templates.templateKey, set: { body, format, updatedBy: userId, updatedAt: now() } }).run();
      await say(chatId, `✅ Plantilla “${kind}” guardada para ${id} (${format}). Usa {texto} para insertar el texto al publicar.`);
      return;
    }
    if (command === '/template_list') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /template_list ID_CANAL');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      const rows = await db.select().from(templates).where(eq(templates.channelId, id)).all();
      await say(chatId, rows.length ? '📝 PLANTILLAS\n' + rows.map(t => `• ${t.kind} (${t.format}): ${t.body.slice(0, 120)}`).join('\n') : 'No hay plantillas para ese canal.');
      return;
    }
    if (command === '/template_buttons') {
      const id = parseId(args[0]); const kind = args[1];
      const secondSpace = argText.indexOf(' ', argText.indexOf(' ') + 1);
      const rawJson = secondSpace >= 0 ? argText.slice(secondSpace + 1).trim() : '';
      if (!Number.isSafeInteger(id) || !kind || !rawJson) return void await say(chatId, 'Uso: /template_buttons ID_CANAL TIPO JSON_INLINE_KEYBOARD');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      let keyboard;
      try { keyboard = JSON.parse(rawJson); } catch { return void await say(chatId, 'JSON no válido. Ejemplo: [[{"text":"Abrir","url":"https://t.me/","style":"primary"}]]'); }
      if (!Array.isArray(keyboard) || keyboard.length > 8 || keyboard.some(row => !Array.isArray(row) || row.length > 8 || row.some(btn => !btn || typeof btn.text !== 'string' || !(typeof btn.url === 'string' || typeof btn.callback_data === 'string')))) {
        return void await say(chatId, 'Cada botón debe tener text y una url o callback_data; máximo 8 filas y 8 botones por fila.');
      }
      const templateKey = `${id}:${kind}`;
      const existing = await db.select().from(templates).where(eq(templates.templateKey, templateKey)).get();
      if (!existing) return void await say(chatId, 'Primero crea la plantilla con /template_set ID_CANAL TIPO FORMATO texto.');
      await db.update(templates).set({ buttonsJson: JSON.stringify(keyboard), updatedBy: userId, updatedAt: now() }).where(eq(templates.templateKey, templateKey)).run();
      await say(chatId, '✅ Botones guardados. Campos extra admitidos por Telegram, como icon_custom_emoji_id o style, se conservarán si la API los admite.');
      return;
    }
    if (command === '/template_delete') {
      const id = parseId(args[0]); const kind = args[1];
      if (!Number.isSafeInteger(id) || !kind) return void await say(chatId, 'Uso: /template_delete ID_CANAL TIPO');
      if (!(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no existe o no está asignado a tu administración.');
      await db.delete(templates).where(eq(templates.templateKey, `${id}:${kind}`)).run();
      await say(chatId, '✅ Plantilla eliminada.');
      return;
    }
    if (command === '/publish_paid') {
      const id = parseId(args[0]); const price = Number(args[1]); const body = args.slice(2).join(' ').trim();
      const reply = message.reply_to_message;
      if (!Number.isSafeInteger(id) || !Number.isInteger(price) || price < 1 || price > 100000) {
        return void await say(chatId, 'Uso: /publish_paid ID_CANAL PRECIO_STARS texto, o responde a un mensaje con /publish_paid ID_CANAL PRECIO_STARS.');
      }
      if (!body && !reply?.message_id) return void await say(chatId, 'Incluye el texto de pago o responde a un mensaje que contenga el contenido.');
      const channel = await db.select().from(channels).where(eq(channels.chatId, id)).get();
      if (!channel || !channel.active || !(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no está activo o no está asignado a tu administración.');
      const publicationKey = `p_${now().toString(36)}_${Math.abs(id).toString(36)}`;
      const teaser = await api.sendMessage({
        chat_id: id,
        text: `💎 PUBLICACIÓN EXCLUSIVA\n\nPrecio: ⭐ ${price}\nPulsa el botón para desbloquear el contenido con Telegram Stars.`,
        reply_markup: { inline_keyboard: [[{ text: `⭐ Desbloquear · ${price}`, url: `https://t.me/CANALES-BOT?start=buy_${publicationKey}` }]] },
      });
      const payload = body
        ? { type: 'text', text: body }
        : { type: 'copy', sourceChatId: chatId, sourceMessageId: Number(reply.message_id) };
      await db.insert(publications).values({
        publicationKey, channelId: id, sourceMessageId: Number(teaser.message_id),
        status: 'paid', starsPrice: price, payloadJson: JSON.stringify(payload),
        createdBy: userId, createdAt: now(), updatedAt: now(),
      }).run();
      await say(chatId, `✅ Publicación de pago creada en ${channel.title || id}. Precio: ⭐ ${price}. Prueba el enlace antes de promocionarla.`);
      return;
    }
    if (command === '/publish') {
      const id = parseId(args[0]); let body = argText.slice(String(args[0] ?? '').length).trim();
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /publish ID_CANAL texto, o responde a un mensaje multimedia con /publish ID_CANAL.');
      const row = await db.select().from(channels).where(eq(channels.chatId, id)).get();
      if (!row || !row.active || !(await canManageChannel(userId, id))) return void await say(chatId, '⛔ Ese canal no está activo o no está asignado a tu administración.');
      const template = await db.select().from(templates).where(eq(templates.templateKey, `${id}:default`)).get();
      const settings = await ensureSettings(id);
      if (!body && !message.reply_to_message?.message_id && settings.missingDataText) body = settings.missingDataText;
      let replyMarkup = {};
      try {
        const keyboard = JSON.parse(template?.buttonsJson || '[]');
        if (Array.isArray(keyboard) && keyboard.length) replyMarkup = { reply_markup: { inline_keyboard: keyboard } };
      } catch { /* publicar sin botones si el JSON está dañado */ }
      let sent; let payload; const format = String(template?.format || 'HTML').toUpperCase();
      if (!body && message.reply_to_message?.message_id) {
        sent = await api.copyMessage({ chat_id: id, from_chat_id: chatId, message_id: message.reply_to_message.message_id, ...replyMarkup });
        payload = { copiedMessageId: message.reply_to_message.message_id, type: 'copied_message' };
      } else {
        if (!body) return void await say(chatId, 'Escribe texto o responde a una foto/vídeo/documento con /publish ID_CANAL.');
        const corrected = Number(settings.textCorrectionEnabled) ? correctText(body) : body;
        if (format === 'RICH_MESSAGE') {
          let richMessage;
          try {
            richMessage = template?.body ? JSON.parse(template.body) : { markdown: corrected };
          } catch {
            return void await say(chatId, 'La plantilla RICH_MESSAGE debe ser JSON válido. Usa, por ejemplo: {"markdown":"**{texto}**"}');
          }
          const replaceText = value => {
            if (typeof value === 'string') return value.replaceAll('{texto}', corrected);
            if (Array.isArray(value)) return value.map(replaceText);
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceText(item)]));
            return value;
          };
          richMessage = replaceText(richMessage);
          const field = ['markdown', 'html'].find(key => typeof richMessage[key] === 'string');
          if (field) {
            if (settings.descriptionTemplate) richMessage[field] = settings.descriptionTemplate.replaceAll('{texto}', richMessage[field]);
            if (settings.hashtags) richMessage[field] += '\n\n' + settings.hashtags;
          } else if (Array.isArray(richMessage.blocks)) {
            if (settings.descriptionTemplate) richMessage.blocks.push({ type: 'paragraph', text: settings.descriptionTemplate.replaceAll('{texto}', corrected) });
            if (settings.hashtags) richMessage.blocks.push({ type: 'paragraph', text: settings.hashtags });
          } else {
            return void await say(chatId, 'RICH_MESSAGE necesita una propiedad markdown, html o blocks.');
          }
          sent = await api.sendRichMessage({ chat_id: id, rich_message: richMessage, ...replyMarkup });
          payload = { rich_message: richMessage, format };
        } else {
          let rendered = template?.body ? template.body.replaceAll('{texto}', corrected) : corrected;
          if (settings.descriptionTemplate) rendered = settings.descriptionTemplate.replaceAll('{texto}', rendered);
          if (settings.hashtags) rendered += '\n\n' + settings.hashtags;
          const extra = format === 'OFF' ? {} : { parse_mode: format === 'MARKDOWN' ? 'Markdown' : format === 'MARKDOWNV2' ? 'MarkdownV2' : 'HTML' };
          sent = await api.sendMessage({ chat_id: id, text: rendered, ...extra, ...replyMarkup });
          payload = { text: rendered, format };
        }
      }
      const messageId = sent.message_id ?? sent.message_ids?.[0] ?? now();
      const publicationKey = `${id}:${messageId}`;
      await db.insert(publications).values({ publicationKey, channelId: id, sourceMessageId: messageId, status: 'published', starsPrice: 0, payloadJson: JSON.stringify(payload), createdBy: userId, createdAt: now(), updatedAt: now() }).run();
      await say(chatId, `✅ Publicación enviada a ${row.title || id}.`);
      return;
    }
    if (command === '/stats') {
      const [channelRows, routeRows, templateRows, banRows, pubRows, purchaseRows, reactionRows] = await Promise.all([
        db.select().from(channels).all(), db.select().from(channelRoutes).all(),
        db.select().from(templates).all(), db.select().from(globalBans).all(),
        db.select().from(publications).all(), db.select().from(purchases).all(),
        db.select().from(reactionReports).all(),
      ]);
      await say(chatId, `📊 ESTADÍSTICAS\nCanales: ${channelRows.length}\nRutas: ${routeRows.length}\nPlantillas: ${templateRows.length}\nBlacklist: ${banRows.length}\nPublicaciones: ${pubRows.length}\nCompras registradas: ${purchaseRows.length}\nReacciones identificadas: ${reactionRows.length}`);
      return;
    }
    if (command === '/addadmin' || command === '/deladmin') {
      if (userId !== OWNER_ID) return void await say(chatId, '⛔ Solo el propietario puede gestionar administradores.');
      const target = parseId(args[0]);
      if (!Number.isSafeInteger(target) || target <= 0) return void await say(chatId, `Uso: ${command} ID_USUARIO`);
      if (target === OWNER_ID) return void await say(chatId, 'El propietario ya tiene acceso permanente.');
      if (command === '/addadmin') {
        await db.insert(admins).values({ userId: target, role: 'admin', createdAt: now() }).onConflictDoNothing().run();
        await say(chatId, `✅ Administrador añadido: ${target}`);
      } else {
        await db.delete(admins).where(eq(admins.userId, target)).run();
        await say(chatId, `✅ Administrador eliminado: ${target}`);
      }
      return;
    }
    await say(chatId, 'Comando no reconocido. Usa /help.');
  } catch (error) {
    console.log('Error en comando administrativo', command, String(error));
    await say(chatId, '⚠️ No se pudo completar la acción. Revisa el ID, el esquema migrado y los permisos del bot.');
  }
}
