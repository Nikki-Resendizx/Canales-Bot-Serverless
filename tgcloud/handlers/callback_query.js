import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import {
  admins, captchaSessions, channels, channelSettings, channelRoutes,
  templates, globalBans, publications, purchases, reactionReports, botTexts,
} from '../schema.js';

const OWNER_ID = 8624574996;
const NAV_DEFAULTS = {
  panel_title: '⚙️ PANEL DE ADMINISTRACIÓN',
  panel_description: 'Selecciona un módulo.',
  channels: '📣 Canales', welcome: '👋 Bienvenida', captcha: '🧩 CAPTCHA',
  blacklist: '🚫 Blacklist', routes: '🔀 Rutas', templates: '📝 Plantillas',
  publications: '📤 Publicaciones', buttons: '🔘 Botones', formats: '🎨 Formatos',
  reactions: '🔔 Reacciones', stars: '💳 Stars', admins: '👮 Admins',
  stats: '📊 Estadísticas', settings: '⚙️ Configuración', close: '❌ Cerrar',
  navigation: '🧭 Navegación', back: '⬅️ Volver al panel',
};
async function navText(key) {
  const row = await db.select().from(botTexts).where(eq(botTexts.textKey, key)).get();
  return row?.body || NAV_DEFAULTS[key] || key;
}
async function buildMainMenu() {
  const keys = [
    ['channels', 'welcome', 'captcha'],
    ['blacklist', 'routes', 'templates'],
    ['publications', 'buttons', 'formats'],
    ['reactions', 'stars', 'admins'],
    ['stats', 'settings', 'close'],
    ['navigation'],
  ];
  const menu = [];
  for (const row of keys) {
    const buttons = [];
    for (const key of row) buttons.push({ text: await navText(key), callback_data: key === 'close' ? 'admin:close' : 'admin:' + key });
    menu.push(buttons);
  }
  return menu;
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
async function answer(query, text = '', alert = false) {
  await api.answerCallbackQuery({
    callback_query_id: query.id,
    ...(text ? { text, show_alert: alert } : {}),
  });
}
async function sendPanel(chatId, text, keyboard = null, messageId = null) {
  if (messageId) {
    try {
      await api.editMessageText({ chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: keyboard || [] } });
      return;
    } catch (error) {
      const reason = String(error ?? '');
      if (/message is not modified/i.test(reason)) return;
      console.log('No se pudo editar el panel', reason);
      return;
    }
  }
  await api.sendMessage({ chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard || [] } });
}
function channelButtons(rows, kind) {
  return rows.map((row) => [{
    text: `${String(row.title || row.chatId).slice(0, 42)} · ${kind === 'welcome' ? 'Bienvenida' : 'CAPTCHA'}: ${Number(kind === 'welcome' ? row.welcomeEnabled : row.captchaEnabled) ? 'ON' : 'OFF'}`,
    callback_data: `admin:toggle:${kind}:${row.chatId}`,
  }]);
}
async function backRow() { return [{ text: await navText('back'), callback_data: 'admin:back' }]; }
function moduleText(section) {
  const modules = {
    publications: '📤 PUBLICACIONES\n\nPublicar texto: /publish ID_CANAL texto\nPublicar un mensaje con foto/vídeo/documento: responde a ese mensaje con /publish ID_CANAL\n\nPublicación de pago: /publish_paid ID_CANAL PRECIO_STARS texto (o responde a un mensaje). Prueba cualquier cobro con Stars antes de promocionarlo. El bot debe ser administrador en el canal.',
    buttons: '🔘 BOTONES INLINE\n\nDefine los botones de una plantilla como JSON: /template_buttons ID_CANAL TIPO JSON\nEjemplo: /template_buttons -100123 default [[{"text":"Abrir","url":"https://t.me/"}]]\nCada botón debe tener text y una url o callback_data. Los botones se adjuntan al publicar usando la plantilla default.',
    formats: '🎨 FORMATOS Y VARIABLES\n\nFormatos disponibles: HTML, Markdown, MarkdownV2, OFF y RICH_MESSAGE (JSON válido).\nGuardar plantilla: /template_set ID_CANAL TIPO FORMATO texto. Editor: /correction ID on|off, /hashtags ID texto, /description ID texto, /missingdata ID texto\nVariables para plantillas: {texto}. Variables de bienvenida: {mencion}, {nombre}, {username}, {userid}.\nUsa HTML para enlaces, negrita, cursiva, subrayado y código admitidos por Telegram.',
    reactions: '🔔 REPORTES DE REACCIONES\n\nConfigurar canal de avisos: /setreport ID_CANAL ID_CANAL_REPORTE\nSe generan reportes separados: las reacciones individuales identificables se reportan con usuario/ID; los eventos de conteo se reportan como agregados y nunca inventan identidades. Telegram debe enviar los eventos de reacción al bot.',
    settings: '⚙️ CONFIGURACIÓN\n\nAñade el bot como administrador en cada canal/grupo con los permisos necesarios. Registra canales con /addchannel ID título.\nComandos: /help\nLa caché de módulos y la sincronización del webhook las administra Telegram Serverless/GitHub Actions, no un botón ficticio dentro del bot.',
    stars: '💳 TELEGRAM STARS\n\nEl flujo básico está conectado: /publish_paid ID_CANAL PRECIO_STARS texto, o responde a un mensaje para vender su copia. Usa moneda XTR (Telegram Stars). Antes de anunciarlo, haz una compra de prueba; los reembolsos todavía no están implementados.',
    blacklist: '🚫 BLACKLIST GLOBAL\n\nAñadir: /blacklist_add ID [@usuario] [motivo]\nQuitar: /blacklist_remove ID\nConsultar: /blacklist\nLos baneos se aplican al entrar en grupos donde el bot tenga permiso de banear.',
    routes: '🔀 RUTAS ENTRE CANALES\n\nCrear: /route_add ID_ORIGEN ID_DESTINO\nEliminar: /route_remove ID_ORIGEN ID_DESTINO\nConsultar: /routes\nEl bot necesita permiso de lectura en el origen y publicación en el destino. Las rutas solo operan en canales registrados.',
    templates: '📝 PLANTILLAS\n\nCrear/editar: /template_set ID_CANAL TIPO FORMATO texto\nListar: /template_list ID_CANAL\nBotones: /template_buttons ID_CANAL TIPO JSON\nEliminar: /template_delete ID_CANAL TIPO\nLa plantilla default se usa para publicar con /publish.',
  };
  return modules[section] || '';
}

export default async function (query) {
  if (!query?.id) return;
  const data = String(query.data ?? '');
  const userId = Number(query.from?.id);
  const message = query.message;
  const chatId = Number(message?.chat?.id);
  const renderPanel = async (text, keyboard = null) => sendPanel(chatId, text, keyboard || await buildMainMenu(), message?.message_id);

  if (data.startsWith('captcha:')) {
    const [, rawChatId, rawUserId, chosenAnswer] = data.split(':');
    const targetChatId = Number(rawChatId);
    const targetUserId = Number(rawUserId);
    if (!Number.isSafeInteger(targetChatId) || !Number.isSafeInteger(targetUserId) ||
        chatId !== targetChatId || userId !== targetUserId) {
      await answer(query, 'Este CAPTCHA no te pertenece.', true);
      return;
    }
    const sessionKey = `${targetChatId}:${targetUserId}`;
    const session = await db.select().from(captchaSessions).where(eq(captchaSessions.sessionKey, sessionKey)).get();
    if (!session) { await answer(query, 'El CAPTCHA ya no está activo.', true); return; }
    await answer(query);
    await db.delete(captchaSessions).where(eq(captchaSessions.sessionKey, sessionKey)).run();
    if (session.expiresAt < Date.now() || String(chosenAnswer) !== String(session.expectedAnswer)) {
      await api.banChatMember({ chat_id: targetChatId, user_id: targetUserId, revoke_messages: true });
      await api.sendMessage({ chat_id: targetChatId, text: `🚫 Usuario ${targetUserId} bloqueado permanentemente por fallar o dejar vencer el CAPTCHA.` });
      return;
    }
    await api.sendMessage({ chat_id: targetChatId, text: `✅ Usuario ${targetUserId} verificó el CAPTCHA correctamente.` });
    return;
  }

  if (!data.startsWith('admin:')) { await answer(query, 'Acción desconocida.'); return; }
  if (!userId || chatId !== userId || !(await isAdmin(userId))) {
    await answer(query, 'No tienes permiso para usar este panel.', true);
    return;
  }

  const parts = data.split(':');
  const section = parts[1];

  if (section === 'open') {
    await answer(query);
    await renderPanel((await navText('panel_title')) + '\nChannelPosts_RoBot\n' + (await navText('panel_description')));
    return;
  }
  if (section === 'close') {
    await answer(query);
    if (message?.message_id) await api.deleteMessage({ chat_id: chatId, message_id: message.message_id });
    return;
  }
  if (section === 'back') {
    await answer(query);
    await renderPanel((await navText('panel_title')) + '\nChannelPosts_RoBot\n' + (await navText('panel_description')));
    return;
  }
  if (section === 'toggle') {
    const kind = parts[2];
    const channelId = Number(parts[3]);
    if (!Number.isSafeInteger(channelId) || !['welcome', 'captcha'].includes(kind)) {
      await answer(query, 'Configuración no válida.', true);
      return;
    }
    const row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    if (!row) { await answer(query, 'Primero registra el canal con /addchannel ID título.', true); return; }
    if (!(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para administrar ese canal.', true); return; }
    const column = kind === 'welcome' ? 'welcomeEnabled' : 'captchaEnabled';
    const enabled = Number(row[column]) ? 0 : 1;
    await db.update(channelSettings).set({ [column]: enabled, updatedAt: Date.now() }).where(eq(channelSettings.channelId, channelId)).run();
    await answer(query, `${kind === 'welcome' ? 'Bienvenida' : 'CAPTCHA'} ${enabled ? 'activado' : 'desactivado'}`);
    const rows = await managedChannels(userId);
    const settingsRows = [];
    for (const channel of rows) {
      const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channel.chatId)).get();
      settingsRows.push({ ...channel, welcomeEnabled: setting?.welcomeEnabled ?? 0, captchaEnabled: setting?.captchaEnabled ?? 0 });
    }
    const keyboard = channelButtons(settingsRows, kind);
    keyboard.push(await backRow());
    await renderPanel((kind === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL') + '\nPulsa un canal para alternar la función.', keyboard);
    return;
  }

  await answer(query);
  if (section === 'navigation') {
    await renderPanel('🧭 TEXTOS DE NAVEGACIÓN\n\nUsa /navtexts para consultar las claves. Edita con /navtext CLAVE nuevo texto. Para restaurar: /navtext CLAVE default.\n\nClaves: panel_title, panel_description, channels, welcome, captcha, blacklist, routes, templates, publications, buttons, formats, reactions, stars, admins, stats, settings, close, navigation, back.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'channels') {
    const rows = await managedChannels(userId);
    const text = rows.length ? '📣 CANALES REGISTRADOS\n' + rows.map(c => `• ${c.title || 'Sin título'} — ${c.chatId} — ${c.active ? 'activo' : 'inactivo'}`).join('\n') : 'No hay canales registrados.';
    await renderPanel(text + '\n\nQuitar: /delchannel ID', [
      [{ text: '➕ Añadir por ID', callback_data: 'admin:channeladd' }, { text: '🔎 Detectar canal', callback_data: 'admin:detectchannel' }],
      [{ text: await navText('back'), callback_data: 'admin:back' }],
    ]);
    return;
  }
  if (section === 'welcome' || section === 'captcha') {
    const rows = await managedChannels(userId);
    const settingsRows = [];
    for (const channel of rows) {
      const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channel.chatId)).get();
      settingsRows.push({ ...channel, welcomeEnabled: setting?.welcomeEnabled ?? 0, captchaEnabled: setting?.captchaEnabled ?? 0 });
    }
    const keyboard = channelButtons(settingsRows, section);
    keyboard.push(await backRow());
    await renderPanel((section === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL') + '\nPulsa un canal para activar/desactivar.\n' + (section === 'welcome' ? 'Editar texto: /welcometext ID texto' : 'Fallo o vencimiento aplica bloqueo permanente.'), keyboard);
    return;
  }
  if (section === 'admins') {
    if (userId !== OWNER_ID) { await renderPanel('👮 Solo el propietario puede gestionar administradores.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]); return; }
    const rows = await db.select().from(admins).all();
    await renderPanel('👮 ADMINISTRADORES\n' + (rows.length ? rows.map(a => `• ${a.userId} (${a.role})`).join('\n') : 'Sin administradores adicionales.') + '\n\nAñadir: /addadmin ID\nEliminar: /deladmin ID', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'stats') {
    const [c, r, t, b, p, purchaseRows, reactionRows] = await Promise.all([
      db.select().from(channels).all(), db.select().from(channelRoutes).all(),
      db.select().from(templates).all(), db.select().from(globalBans).all(),
      db.select().from(publications).all(), db.select().from(purchases).all(),
      db.select().from(reactionReports).all(),
    ]);
    await renderPanel(`📊 ESTADÍSTICAS\nCanales: ${c.length}\nRutas: ${r.length}\nPlantillas: ${t.length}\nBlacklist: ${b.length}\nPublicaciones: ${p.length}\nCompras registradas: ${purchaseRows.length}\nReacciones identificadas registradas: ${reactionRows.length}`, [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'stars') {
    await renderPanel(moduleText('stars'), [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'channeladd') {
    await renderPanel('➕ AÑADIR CANAL\nEnvía en este chat: /addchannel ID Título. El bot debe ser administrador del canal.', [[{ text: await navText('back'), callback_data: 'admin:channels' }]]);
    return;
  }
  if (section === 'detectchannel') {
    await renderPanel('🔎 DETECTAR CANAL\n1. Reenvía al bot una publicación del canal que quieres conectar.\n2. Responde a esa publicación reenviada con: /addchannel Título\nEl bot leerá el ID del canal desde los metadatos del reenvío; si Telegram oculta esos metadatos, usa el ID manualmente.', [[{ text: await navText('back'), callback_data: 'admin:channels' }]]);
    return;
  }
  const text = moduleText(section);
  if (text) {
    await renderPanel(text, [[{ text: '📚 Ver comandos', callback_data: 'admin:help' }, { text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'help') {
    await renderPanel('Comandos generales: /help, /channels, /addchannel, /delchannel, /welcome, /welcometext, /captcha, /setreport, /blacklist_add, /blacklist_remove, /blacklist, /route_add, /route_remove, /routes, /template_set, /template_list, /template_buttons, /template_delete, /publish, /stats, /addadmin y /deladmin.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  await renderPanel('Sección no reconocida.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
}
