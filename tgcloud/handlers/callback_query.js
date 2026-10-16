import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import {
  admins, captchaSessions, channels, channelSettings, channelRoutes,
  templates, globalBans, publications, purchases, reactionReports, botTexts,
} from '../schema.js';

const OWNER_ID = 8624574996;
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
      // No dejar el panel invisible si Telegram no permite editar el mensaje original.
      console.log('No se pudo editar el panel; se enviará un mensaje nuevo', reason);
    }
  }
  await api.sendMessage({ chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard || [] } });
}
function channelButtons(rows, kind) {
  return rows.map((row) => [{
    text: `${String(row.title || row.chatId).slice(0, 42)} · ${kind === 'welcome' ? 'Bienvenida' : kind === 'captcha' ? 'CAPTCHA' : 'Corrección'}: ${Number(kind === 'welcome' ? row.welcomeEnabled : kind === 'captcha' ? row.captchaEnabled : row.textCorrectionEnabled) ? 'ON' : 'OFF'}`,
    callback_data: `admin:toggle:${kind}:${row.chatId}`,
  }]);
}
function channelManagementButtons(rows) {
  const keyboard = [];
  for (const row of rows) {
    const label = String(row.title || row.chatId).slice(0, 24);
    keyboard.push([
      { text: `${row.active ? '🟢' : '🔴'} ${label}`, callback_data: `admin:channelsettings:${row.chatId}` },
      { text: row.active ? '⏸ Desactivar' : '▶️ Activar', callback_data: `admin:channelactive:${row.chatId}` },
      { text: '🗑️', callback_data: `admin:channeldelete:${row.chatId}` },
    ]);
  }
  keyboard.push([{ text: '➕ Agregar Canal', callback_data: 'admin:channeladd' }]);
  keyboard.push([{ text: '➕ Añadir por ID', callback_data: 'admin:channeladdmanual' }, { text: '🔎 Detectar canal', callback_data: 'admin:detectchannel' }]);
  keyboard.push([{ text: '🔙 VOLVER', callback_data: 'admin:back' }]);
  return keyboard;
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
    await renderPanel((await navText('panel_title')) + '\nCANALES-BOT\n' + (await navText('panel_description')));
    return;
  }
  if (section === 'close') {
    await answer(query);
    if (message?.message_id) await api.deleteMessage({ chat_id: chatId, message_id: message.message_id });
    return;
  }
  if (section === 'back') {
    await answer(query);
    await renderPanel((await navText('panel_title')) + '\nCANALES-BOT\n' + (await navText('panel_description')));
    return;
  }
  if (section === 'toggle') {
    const kind = parts[2];
    const channelId = Number(parts[3]);
    if (!Number.isSafeInteger(channelId) || !['welcome', 'captcha', 'correction'].includes(kind)) {
      await answer(query, 'Configuración no válida.', true);
      return;
    }
    const row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    if (!row) { await answer(query, 'Primero registra el canal con /addchannel ID título.', true); return; }
    if (!(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para administrar ese canal.', true); return; }
    const column = kind === 'welcome' ? 'welcomeEnabled' : kind === 'captcha' ? 'captchaEnabled' : 'textCorrectionEnabled';
    const enabled = Number(row[column]) ? 0 : 1;
    await db.update(channelSettings).set({ [column]: enabled, updatedAt: Date.now() }).where(eq(channelSettings.channelId, channelId)).run();
    await answer(query, `${kind === 'welcome' ? 'Bienvenida' : kind === 'captcha' ? 'CAPTCHA' : 'Corrección de texto'} ${enabled ? 'activado' : 'desactivado'}`);
    const rows = await managedChannels(userId);
    const settingsRows = [];
    for (const channel of rows) {
      const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channel.chatId)).get();
      settingsRows.push({ ...channel, welcomeEnabled: setting?.welcomeEnabled ?? 0, captchaEnabled: setting?.captchaEnabled ?? 0 });
    }
    const keyboard = channelButtons(settingsRows, kind);
    keyboard.push(await backRow());
    await renderPanel((kind === 'welcome' ? '👋 BIENVENIDA POR CANAL' : kind === 'captcha' ? '🧩 CAPTCHA POR CANAL' : '✍️ CORRECCIÓN POR CANAL') + '\nPulsa un canal para alternar la función.', keyboard);
    return;
  }

  if (section === 'channelactive') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!channel) { await answer(query, 'El canal ya no está registrado.', true); return; }
    const active = Number(channel.active) ? 0 : 1;
    await db.update(channels).set({ active }).where(eq(channels.chatId, channelId)).run();
    await answer(query, active ? 'Procesamiento del canal activado.' : 'Procesamiento del canal desactivado.');
    await renderPanel('📣 ADMINISTRACIÓN DE CANALES\\n\\nActiva o pausa el procesamiento automático por canal. Pulsa el nombre para configurar opciones individuales.', channelManagementButtons(await managedChannels(userId)));
    return;
  }
  if (section === 'channeldelete') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!channel) { await answer(query, 'El canal ya no está registrado.', true); return; }
    await answer(query);
    await renderPanel('⚠️ CONFIRMAR ELIMINACIÓN\\n\\nSe quitará ' + String(channel.title || channelId) + ' (' + channelId + ') y su configuración individual. Las publicaciones ya enviadas a Telegram no se borrarán.', [
      [{ text: '🗑️ Sí, eliminar configuración', callback_data: 'admin:channeldeleteconfirm:' + channelId }],
      [{ text: '🔙 Cancelar', callback_data: 'admin:channels' }],
    ]);
    return;
  }
  if (section === 'channeldeleteconfirm') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    await db.delete(channels).where(eq(channels.chatId, channelId)).run();
    await db.delete(channelSettings).where(eq(channelSettings.channelId, channelId)).run();
    await db.delete(channelRoutes).where(eq(channelRoutes.sourceChatId, channelId)).run();
    await db.delete(channelRoutes).where(eq(channelRoutes.destinationChatId, channelId)).run();
    await answer(query, 'Canal y configuración eliminados.');
    await renderPanel('📣 ADMINISTRACIÓN DE CANALES\\n\\nCanal eliminado de la configuración. Las publicaciones ya enviadas no se borran.', channelManagementButtons(await managedChannels(userId)));
    return;
  }
  if (section === 'channelsettings') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!channel) { await answer(query, 'El canal ya no está registrado.', true); return; }
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    await answer(query);
    await renderPanel('⚙️ CONFIGURACIÓN INDIVIDUAL\\n\\n' + String(channel.title || channelId) + ' (' + channelId + ')\\nProcesamiento: ' + (channel.active ? 'ACTIVO' : 'PAUSADO') + '\\nBienvenida: ' + (setting?.welcomeEnabled ? 'ON' : 'OFF') + '\\nCAPTCHA: ' + (setting?.captchaEnabled ? 'ON' : 'OFF') + '\\nCorrección de texto: ' + (setting?.textCorrectionEnabled ? 'ON' : 'OFF') + '\\n\\nCada opción se guarda por separado para este canal.', [
      [{ text: '👋 Bienvenida ' + (setting?.welcomeEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:welcome:' + channelId }],
      [{ text: '🧩 CAPTCHA ' + (setting?.captchaEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:captcha:' + channelId }],
      [{ text: '✍️ Corrección ' + (setting?.textCorrectionEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:correction:' + channelId }],
      [{ text: '✏️ Editar bienvenida', callback_data: 'admin:welcomeedit:' + channelId }],
      [{ text: '🔙 Volver a canales', callback_data: 'admin:channels' }],
    ]);
    return;
  }
  if (section === 'welcomeedit') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    await answer(query);
    await renderPanel('✏️ EDITAR BIENVENIDA\\n\\nEnvía el comando en este chat privado:\\n/welcometext ' + channelId + ' Tu texto de bienvenida\\n\\nVariables: {mencion}, {nombre}, {username}, {userid}.', [
      [{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }],
    ]);
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
    await renderPanel(text + '\\n\\nPulsa el nombre de un canal para abrir sus opciones, activa/pausa el procesamiento o elimina su configuración. La eliminación requiere confirmación.', channelManagementButtons(rows));
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
    await renderPanel('➕ AGREGAR CANAL\n\nPulsa el botón del mensaje siguiente y elige el canal. Telegram te pedirá agregar el bot como administrador y seleccionar los permisos solicitados. Cuando Telegram confirme que el bot es administrador, el canal se registrará automáticamente.\n\nSi el selector no está disponible en tu cliente, usa “Añadir por ID”.', [[{ text: await navText('back'), callback_data: 'admin:channels' }]]);
    await api.sendMessage({
      chat_id: chatId,
      text: 'Selecciona el canal que quieres conectar:',
      reply_markup: {
        keyboard: [[{
          text: '➕ Elegir canal y agregar bot',
          request_chat: {
            request_id: 71001,
            chat_is_channel: true,
            user_administrator_rights: {
              can_manage_chat: true,
              can_post_messages: true,
              can_edit_messages: true,
              can_delete_messages: true,
              can_invite_users: true
            },
            bot_administrator_rights: {
              can_manage_chat: true,
              can_post_messages: true,
              can_edit_messages: true,
              can_delete_messages: true,
              can_invite_users: true
            }
          }
        }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: 'Elige un canal para conectar'
      }
    });
    return;
  }
  if (section === 'channeladdmanual') {
    await renderPanel('➕ AÑADIR CANAL POR ID\nEnvía en este chat: /addchannel ID Título. El bot debe ser administrador del canal.', [[{ text: await navText('back'), callback_data: 'admin:channels' }]]);
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
