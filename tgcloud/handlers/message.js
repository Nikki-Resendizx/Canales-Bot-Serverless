import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import {
  admins, channels, channelSettings, globalBans, channelRoutes,
  templates, publications, purchases,
} from '../schema.js';

const OWNER_ID = 8624574996;
const now = () => Date.now();
const parseId = (value) => /^-?\d+$/.test(String(value ?? '')) ? Number(value) : NaN;
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function isAdmin(userId) {
  if (Number(userId) === OWNER_ID) return true;
  return Boolean(await db.select().from(admins).where(eq(admins.userId, Number(userId))).get());
}
async function ownerOnly(userId) { return Number(userId) === OWNER_ID; }
async function say(chatId, text, extra = {}) {
  return api.sendMessage({ chat_id: chatId, text, ...extra });
}
async function ensureSettings(channelId) {
  let row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
  if (!row) {
    await db.insert(channelSettings).values({
      channelId, welcomeEnabled: 0, welcomeText: '👋 ¡Bienvenido, {mencion}!',
      captchaEnabled: 0, captchaQuestion: '', captchaAnswer: '',
      updatedAt: now(),
    }).run();
    row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
  }
  return row;
}
async function renderText(template, user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'usuario';
  return String(template || '')
    .replaceAll('{mencion}', '<a href="tg://user?id=' + Number(user.id) + '">' + escapeHtml(name) + '</a>')
    .replaceAll('{nombre}', escapeHtml(name))
    .replaceAll('{username}', user.username ? '@' + escapeHtml(user.username) : '')
    .replaceAll('{userid}', String(user.id));
}
const MAIN_MENU = [
  [{ text: '📣 Canales', callback_data: 'admin:channels' }, { text: '👋 Bienvenida', callback_data: 'admin:welcome' }, { text: '🧩 CAPTCHA', callback_data: 'admin:captcha' }],
  [{ text: '🚫 Blacklist', callback_data: 'admin:blacklist' }, { text: '🔀 Rutas', callback_data: 'admin:routes' }, { text: '📊 Estadísticas', callback_data: 'admin:stats' }],
  [{ text: '📝 Plantillas', callback_data: 'admin:templates' }, { text: '💳 Stars', callback_data: 'admin:stars' }, { text: '👮 Admins', callback_data: 'admin:admins' }],
  [{ text: '❌ Cerrar', callback_data: 'admin:close' }],
];

export default async function (message) {
  if (!message?.chat?.id || !message?.from) return;
  const chatId = Number(message.chat.id);
  const userId = Number(message.from.id);
  const text = String(message.text ?? '').trim();
  const isPrivate = chatId === userId;

  if (text === '/start' || text.startsWith('/start ')) {
    await say(chatId, '👋 ¡Bienvenido a ChannelPosts_RoBot!\n\nAdministra canales, bienvenida, CAPTCHA, blacklist, rutas y plantillas. Usa /help para ver comandos.');
    return;
  }
  if (text === '/help') {
    await say(chatId,
      '📚 COMANDOS DE CANALES-BOT\n' +
      '/admin — panel\n/channels — canales conectados\n' +
      '/addchannel ID [título] — registrar canal\n/delchannel ID — quitar canal\n' +
      '/welcome ID on|off — activar/desactivar bienvenida\n/welcometext ID texto — editar bienvenida\n' +
      '/captcha ID on|off — activar/desactivar CAPTCHA\n' +
      '/setreport ID_CANAL ID_REPORTE — canal de reportes de reacciones\n' +
      '/blacklist_add ID [@usuario] [motivo] — blacklist global\n/blacklist_remove ID — quitar de blacklist\n/blacklist — consultar blacklist\n' +
      '/route_add ORIGEN DESTINO — enrutar publicaciones\n/route_remove ORIGEN DESTINO — quitar ruta\n/routes — ver rutas\n' +
      '/template_set ID_CANAL TIPO FORMATO texto — guardar plantilla\n/template_list ID_CANAL — listar plantillas\n' +
      '/publish ID_CANAL texto — publicar texto\n/stats — estadísticas\n' +
      '/addadmin ID y /deladmin ID — solo propietario\n\n' +
      'Formatos de plantilla: HTML, Markdown, MarkdownV2 u OFF. Variables de bienvenida: {mencion}, {nombre}, {username}, {userid}.'
    );
    return;
  }

  if (text === '/admin') {
    if (!isPrivate || !(await isAdmin(userId))) {
      await say(chatId, '⛔ El panel solo está disponible para administradores en chat privado.');
      return;
    }
    await say(chatId, '⚙️ PANEL DE ADMINISTRACIÓN\nChannelPosts_RoBot\n\nSelecciona un módulo. Los botones muestran las acciones y comandos disponibles.', {
      reply_markup: { inline_keyboard: MAIN_MENU },
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
      const rows = await db.select().from(channels).all();
      await say(chatId, rows.length ? '📣 CANALES REGISTRADOS\n' + rows.map(c => `• ${c.title || 'Sin título'} — ${c.chatId} — ${c.active ? 'activo' : 'inactivo'}`).join('\n') : 'No hay canales registrados. Usa /addchannel ID título.');
      return;
    }
    if (command === '/addchannel') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /addchannel ID [título]');
      const title = args.slice(1).join(' ') || String(id);
      await db.insert(channels).values({ chatId: id, title, addedBy: userId, active: 1, createdAt: now() })
        .onConflictDoUpdate({ target: channels.chatId, set: { title, active: 1 } }).run();
      await ensureSettings(id);
      await say(chatId, `✅ Canal registrado: ${title} (${id}). Asegúrate de que el bot tenga permisos de administrador.`);
      return;
    }
    if (command === '/delchannel') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /delchannel ID');
      await db.delete(channels).where(eq(channels.chatId, id)).run();
      await say(chatId, `✅ Canal ${id} eliminado del registro. Revisa y elimina manualmente sus rutas si corresponde.`);
      return;
    }
    if (command === '/welcome') {
      const id = parseId(args[0]); const mode = String(args[1] || '').toLowerCase();
      if (!Number.isSafeInteger(id) || !['on','off'].includes(mode)) return void await say(chatId, 'Uso: /welcome ID on|off');
      await ensureSettings(id);
      await db.update(channelSettings).set({ welcomeEnabled: mode === 'on' ? 1 : 0, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, `✅ Bienvenida ${mode === 'on' ? 'activada' : 'desactivada'} para ${id}.`);
      return;
    }
    if (command === '/welcometext') {
      const id = parseId(args[0]); const body = argText.slice(String(args[0] ?? '').length).trim();
      if (!Number.isSafeInteger(id) || !body) return void await say(chatId, 'Uso: /welcometext ID texto. Variables: {mencion}, {nombre}, {username}, {userid}.');
      await ensureSettings(id);
      await db.update(channelSettings).set({ welcomeText: body, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, '✅ Texto de bienvenida guardado.');
      return;
    }
    if (command === '/captcha') {
      const id = parseId(args[0]); const mode = String(args[1] || '').toLowerCase();
      if (!Number.isSafeInteger(id) || !['on','off'].includes(mode)) return void await say(chatId, 'Uso: /captcha ID on|off');
      await ensureSettings(id);
      await db.update(channelSettings).set({ captchaEnabled: mode === 'on' ? 1 : 0, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, `✅ CAPTCHA ${mode === 'on' ? 'activado' : 'desactivado'} para ${id}.`);
      return;
    }
    if (command === '/setreport') {
      const id = parseId(args[0]); const reportId = parseId(args[1]);
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(reportId)) return void await say(chatId, 'Uso: /setreport ID_CANAL ID_REPORTE');
      await ensureSettings(id);
      await db.update(channelSettings).set({ reactionReportChatId: reportId, updatedAt: now() }).where(eq(channelSettings.channelId, id)).run();
      await say(chatId, '✅ Canal de reportes configurado. El bot debe poder publicar allí.');
      return;
    }
    if (command === '/blacklist_add') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /blacklist_add ID [@usuario] [motivo]');
      const username = args[1]?.startsWith('@') ? args[1].slice(1) : '';
      const reason = args.slice(username ? 2 : 1).join(' ') || 'Sin motivo especificado';
      await db.insert(globalBans).values({ userId: id, username, reason, bannedBy: userId, createdAt: now() })
        .onConflictDoUpdate({ target: globalBans.userId, set: { username, reason, bannedBy: userId, createdAt: now() } }).run();
      await say(chatId, `🚫 Usuario ${id} añadido a la blacklist global. Se bloqueará al entrar en grupos donde el bot pueda banear.`);
      return;
    }
    if (command === '/blacklist_remove') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /blacklist_remove ID');
      await db.delete(globalBans).where(eq(globalBans.userId, id)).run();
      await say(chatId, `✅ Usuario ${id} eliminado de la blacklist global.`);
      return;
    }
    if (command === '/blacklist') {
      const rows = await db.select().from(globalBans).all();
      await say(chatId, rows.length ? '🚫 BLACKLIST GLOBAL\n' + rows.map(b => `• ${b.userId} ${b.username ? '@'+b.username : ''} — ${b.reason}`).join('\n') : 'La blacklist está vacía.');
      return;
    }
    if (command === '/route_add') {
      const source = parseId(args[0]); const destination = parseId(args[1]);
      if (!Number.isSafeInteger(source) || !Number.isSafeInteger(destination) || source === destination) return void await say(chatId, 'Uso: /route_add ORIGEN DESTINO (deben ser distintos IDs numéricos).');
      const routeKey = `${source}:${destination}`;
      await db.insert(channelRoutes).values({ routeKey, sourceChatId: source, destinationChatId: destination, createdBy: userId, createdAt: now() })
        .onConflictDoUpdate({ target: channelRoutes.routeKey, set: { sourceChatId: source, destinationChatId: destination, createdBy: userId, createdAt: now() } }).run();
      await say(chatId, `✅ Ruta creada: ${source} → ${destination}. El bot debe ser administrador en ambos canales.`);
      return;
    }
    if (command === '/route_remove') {
      const source = parseId(args[0]); const destination = parseId(args[1]);
      if (!Number.isSafeInteger(source) || !Number.isSafeInteger(destination)) return void await say(chatId, 'Uso: /route_remove ORIGEN DESTINO');
      await db.delete(channelRoutes).where(eq(channelRoutes.routeKey, `${source}:${destination}`)).run();
      await say(chatId, '✅ Ruta eliminada.');
      return;
    }
    if (command === '/routes') {
      const rows = await db.select().from(channelRoutes).all();
      await say(chatId, rows.length ? '🔀 RUTAS ACTIVAS\n' + rows.map(r => `• ${r.sourceChatId} → ${r.destinationChatId}`).join('\n') : 'No hay rutas configuradas.');
      return;
    }
    if (command === '/template_set') {
      const id = parseId(args[0]); const kind = args[1]; const format = String(args[2] || 'HTML').toUpperCase();
      const body = argText.split(/\s+/).slice(3).join(' ');
      if (!Number.isSafeInteger(id) || !kind || !body || !['HTML','MARKDOWN','MARKDOWNV2','OFF'].includes(format)) return void await say(chatId, 'Uso: /template_set ID_CANAL TIPO HTML|Markdown|MarkdownV2|OFF texto');
      const templateKey = `${id}:${kind}`;
      await db.insert(templates).values({ templateKey, channelId: id, kind, body, format, buttonsJson: '[]', updatedBy: userId, updatedAt: now() })
        .onConflictDoUpdate({ target: templates.templateKey, set: { body, format, updatedBy: userId, updatedAt: now() } }).run();
      await say(chatId, `✅ Plantilla “${kind}” guardada para ${id} (${format}).`);
      return;
    }
    if (command === '/template_list') {
      const id = parseId(args[0]);
      if (!Number.isSafeInteger(id)) return void await say(chatId, 'Uso: /template_list ID_CANAL');
      const rows = await db.select().from(templates).where(eq(templates.channelId, id)).all();
      await say(chatId, rows.length ? '📝 PLANTILLAS\n' + rows.map(t => `• ${t.kind} (${t.format}): ${t.body.slice(0,120)}`).join('\n') : 'No hay plantillas para ese canal.');
      return;
    }
    if (command === '/template_buttons') {
      const id = parseId(args[0]); const kind = args[1];
      const rawJson = argText.split(/\\s+/).slice(2).join(' ');
      if (!Number.isSafeInteger(id) || !kind || !rawJson) return void await say(chatId, 'Uso: /template_buttons ID_CANAL TIPO JSON_INLINE_KEYBOARD');
      let keyboard;
      try { keyboard = JSON.parse(rawJson); } catch { return void await say(chatId, 'JSON no válido. Ejemplo: [[{"text":"Visitar","url":"https://t.me/"}]]'); }
      if (!Array.isArray(keyboard) || keyboard.length > 8 || keyboard.some(row => !Array.isArray(row) || row.length > 8 || row.some(btn => !btn || typeof btn.text !== 'string' || !(typeof btn.url === 'string' || typeof btn.callback_data === 'string')))) {
        return void await say(chatId, 'El JSON debe ser una matriz de filas de botones con text y url o callback_data.');
      }
      const templateKey = `${id}:${kind}`;
      const existing = await db.select().from(templates).where(eq(templates.templateKey, templateKey)).get();
      if (!existing) return void await say(chatId, 'Primero crea la plantilla con /template_set ID_CANAL TIPO HTML|Markdown|MarkdownV2|OFF texto.');
      await db.update(templates).set({ buttonsJson: JSON.stringify(keyboard), updatedBy: userId, updatedAt: now() }).where(eq(templates.templateKey, templateKey)).run();
      await say(chatId, '✅ Botones guardados en la plantilla.');
      return;
    }
    if (command === '/template_delete') {
      const id = parseId(args[0]); const kind = args[1];
      if (!Number.isSafeInteger(id) || !kind) return void await say(chatId, 'Uso: /template_delete ID_CANAL TIPO');
      await db.delete(templates).where(eq(templates.templateKey, `${id}:${kind}`)).run();
      await say(chatId, '✅ Plantilla eliminada.');
      return;
    }
    if (command === '/publish') {
      const id = parseId(args[0]); const body = argText.slice(String(args[0] ?? '').length).trim();
      if (!Number.isSafeInteger(id) || !body) return void await say(chatId, 'Uso: /publish ID_CANAL texto');
      const row = await db.select().from(channels).where(eq(channels.chatId, id)).get();
      if (!row || !row.active) return void await say(chatId, '⛔ Ese canal no está registrado o está inactivo.');
      const template = await db.select().from(templates).where(eq(templates.templateKey, `${id}:default`)).get();
      const payload = template?.body ? template.body.replaceAll('{texto}', body) : body;
      const format = String(template?.format || 'HTML').toUpperCase();
      const extra = format === 'OFF' ? {} : { parse_mode: format === 'MARKDOWN' ? 'Markdown' : format === 'MARKDOWNV2' ? 'MarkdownV2' : 'HTML' };
      let replyMarkup = {};
      try {
        const keyboard = JSON.parse(template?.buttonsJson || '[]');
        if (Array.isArray(keyboard) && keyboard.length) replyMarkup = { reply_markup: { inline_keyboard: keyboard } };
      } catch { /* plantilla antigua o JSON dañado: publicar sin botones */ }
      const sent = await api.sendMessage({ chat_id: id, text: payload, ...extra, ...replyMarkup });
      const publicationKey = `${id}:${sent.message_id ?? now()}`;
      await db.insert(publications).values({ publicationKey, channelId: id, sourceMessageId: sent.message_id ?? null, status: 'published', starsPrice: 0, payloadJson: JSON.stringify({ text: payload, format }), createdBy: userId, createdAt: now(), updatedAt: now() }).run();
      await say(chatId, `✅ Publicación enviada a ${row.title || id}.`);
      return;
    }
    if (command === '/stats') {
      const [channelRows, routeRows, templateRows, banRows, pubRows, purchaseRows] = await Promise.all([
        db.select().from(channels).all(), db.select().from(channelRoutes).all(),
        db.select().from(templates).all(), db.select().from(globalBans).all(),
        db.select().from(publications).all(), db.select().from(purchases).all(),
      ]);
      await say(chatId, `📊 ESTADÍSTICAS\nCanales: ${channelRows.length}\nRutas: ${routeRows.length}\nPlantillas: ${templateRows.length}\nBlacklist: ${banRows.length}\nPublicaciones registradas: ${pubRows.length}\nCompras registradas: ${purchaseRows.length}`);
      return;
    }
    if (command === '/addadmin' || command === '/deladmin') {
      if (!(await ownerOnly(userId))) return void await say(chatId, '⛔ Solo el propietario puede gestionar administradores.');
      const target = parseId(args[0]);
      if (!Number.isSafeInteger(target)) return void await say(chatId, `Uso: ${command} ID_USUARIO`);
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
    await say(chatId, '⚠️ No se pudo completar la acción. Revisa que el ID sea correcto, que el esquema esté migrado y que el bot tenga permisos.');
  }
}
