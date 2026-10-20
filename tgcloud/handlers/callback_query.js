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
  channels: '📢 CANALES', welcome: '👋 BIENVENIDA', captcha: '🛡️ CAPTCHA', hashtags: '#️⃣ HASHTAGS',
  blacklist: '🚫 BANEO GLOBAL', routes: '🔀 DISTRIBUCIÓN', templates: '📝 PLANTILLAS',
  rules: '⚙️ REGLAS AUTOMÁTICAS', testmode: '🧪 MODO DE PRUEBA',
  publications: '💰 PUBLICACIONES', buttons: '🔘 BOTONES', formats: '🎨 FORMATOS',
  reactions: '🔔 REACCIONES', stars: '⭐ PREMIUM / ESTRELLAS', admins: '👥 ADMINISTRADORES',
  stats: '📊 ESTADÍSTICAS', settings: '⚙️ CONFIGURACIÓN', close: '❌ CERRAR', navigation: '🧭 NAVEGACIÓN',
  back: '🔙 VOLVER',
};
async function navText(key) {
  // El menú principal debe poder abrirse incluso si la migración de bot_texts aún no terminó.
  try {
    const row = await db.select().from(botTexts).where(eq(botTexts.textKey, key)).get();
    return String(row?.body ?? NAV_DEFAULTS[key] ?? key);
  } catch (error) {
    console.log('No se pudieron leer los textos de navegación; se usarán valores predeterminados', String(error));
    return NAV_DEFAULTS[key] || key;
  }
}
async function buildMainMenu() {
  const keys = [
    ['channels', 'templates', 'hashtags'],
    ['buttons', 'formats', 'rules'],
    ['welcome', 'captcha', 'blacklist'],
    ['routes', 'reactions', 'publications'],
    ['stars', 'stats', 'admins'],
    ['testmode', 'settings', 'navigation'],
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
async function ensureChannelSettings(channelId) {
  let row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, Number(channelId))).get();
  if (!row) {
    await db.insert(channelSettings).values({ channelId: Number(channelId), updatedAt: Date.now() }).onConflictDoNothing().run();
    row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, Number(channelId))).get();
  }
  return row;
}
async function answer(query, text = '', alert = false) {
  await api.answerCallbackQuery({
    callback_query_id: query.id,
    ...(text ? { text, show_alert: alert } : {}),
  });
}
function sanitizeInlineKeyboard(keyboard) {
  if (!Array.isArray(keyboard)) return [];
  return keyboard
    .filter(Array.isArray)
    .map(row => row.filter(button => button && typeof button === 'object' && !Array.isArray(button))
      .map(button => {
        const clean = { ...button, text: String(button.text ?? '') };
        if (clean.callback_data != null) clean.callback_data = String(clean.callback_data);
        if (clean.url != null) clean.url = String(clean.url);
        return clean;
      })
      .filter(button => button.text.trim() && (
        typeof button.callback_data === 'string' ||
        typeof button.url === 'string' ||
        button.web_app || button.login_url || button.switch_inline_query != null ||
        button.switch_inline_query_current_chat != null || button.copy_text ||
        button.callback_game || button.pay === true
      )))
    .filter(row => row.length > 0);
}

async function sendPanel(chatId, text, keyboard = null, messageId = null) {
  const safeKeyboard = sanitizeInlineKeyboard(keyboard);
  if (messageId) {
    try {
      await api.editMessageText({ chat_id: chatId, message_id: messageId, text: String(text ?? ''), reply_markup: { inline_keyboard: safeKeyboard } });
      return;
    } catch (error) {
      const reason = String(error ?? '');
      if (/message is not modified/i.test(reason)) return;
      // No dejar el panel invisible si Telegram no permite editar el mensaje original.
      console.log('No se pudo editar el panel; se enviará un mensaje nuevo', reason);
    }
  }
  await api.sendMessage({ chat_id: chatId, text: String(text ?? ''), reply_markup: { inline_keyboard: safeKeyboard } });
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
    publications: '📤 PUBLICACIONES\n\nLa función principal trabaja con las publicaciones que tú envías manualmente a cada canal conectado. El bot intenta completar ese mismo mensaje con la plantilla, los hashtags y los botones configurados para ese canal, sin crear una copia adicional.\n\nPublica directamente en Telegram dentro del canal conectado.',
    formats: '🎨 FORMATOS Y VARIABLES\n\nEl editor de plantillas permite elegir AUTO, HTML, Markdown, MarkdownV2, OFF o RICH_MESSAGE.\n\nVariables: {contenido}, {texto}, {titulo}, {descripcion}, {enlace}, {hashtags}, {fecha}, {canal}, {vacio}. Si usas {vacio}, no se modifica la publicación ni se añaden botones o hashtags. Para cambiar el formato, abre Plantillas, selecciona el canal y el tipo de publicación.',
    settings: '⚙️ CONFIGURACIÓN GENERAL\n\nAñade el bot como administrador en cada canal y concede permisos para editar mensajes y publicar. Conecta el canal desde 📢 CANALES. Cada canal mantiene su propia configuración.\n\nLos botones del panel permiten cambiar las opciones disponibles; algunas operaciones externas dependen de los permisos concedidos por Telegram.',
    stars: '⭐ PUBLICACIONES DE PAGO\n\nEl flujo básico de Telegram Stars está implementado, pero su editor todavía no está integrado completamente en este panel visual. No publiques ofertas de pago hasta probar el recorrido de compra y entrega de contenido.',
  };
  return modules[section] || '';
}

export default async function (query) {
  try {
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

  if (data.startsWith('btn:popup:')) {
    await answer(query, (data.slice('btn:popup:'.length) || 'Acción del botón').slice(0, 200), true);
    return;
  }
  if (data.startsWith('btn:callback:')) {
    await answer(query, (data.slice('btn:callback:'.length) || 'Acción ejecutada').slice(0, 200), true);
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
    const row = await ensureChannelSettings(channelId);
    if (!row) { await answer(query, 'No se pudo inicializar la configuración del canal. Intenta de nuevo.', true); return; }
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
    await renderPanel('📣 ADMINISTRACIÓN DE CANALES\n\nActiva o pausa el procesamiento automático por canal. Pulsa el nombre para configurar opciones individuales.', channelManagementButtons(await managedChannels(userId)));
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
    await renderPanel('⚠️ CONFIRMAR ELIMINACIÓN\n\nSe quitará ' + String(channel.title || channelId) + ' (' + channelId + ') y su configuración individual. Las publicaciones ya enviadas a Telegram no se borrarán.', [
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
    await db.delete(templates).where(eq(templates.channelId, channelId)).run();
    await db.delete(channels).where(eq(channels.chatId, channelId)).run();
    await db.delete(channelSettings).where(eq(channelSettings.channelId, channelId)).run();
    await db.delete(channelRoutes).where(eq(channelRoutes.sourceChatId, channelId)).run();
    await db.delete(channelRoutes).where(eq(channelRoutes.destinationChatId, channelId)).run();
    await answer(query, 'Canal y configuración eliminados.');
    await renderPanel('📣 ADMINISTRACIÓN DE CANALES\n\nCanal eliminado de la configuración. Las publicaciones ya enviadas no se borran.', channelManagementButtons(await managedChannels(userId)));
    return;
  }
  if (section === 'channeltest') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    await answer(query, 'Comprobando acceso y permisos…');
    try {
      const bot = await api.getMe();
      const [channel, membership] = await Promise.all([
        api.getChat({ chat_id: channelId }),
        api.getChatMember({ chat_id: channelId, user_id: bot.id }),
      ]);
      const isAdmin = membership?.status === 'administrator' || membership?.status === 'creator';
      const canPost = membership?.status === 'creator' || Boolean(membership?.can_post_messages);
      const canEdit = membership?.status === 'creator' || Boolean(membership?.can_edit_messages);
      const canDelete = membership?.status === 'creator' || Boolean(membership?.can_delete_messages);
      const report = [
        '🧪 RESULTADO DE PRUEBA',
        'Canal: ' + String(channel?.title || channel?.username || channelId),
        'ID: ' + channelId,
        'Bot administrador: ' + (isAdmin ? 'Sí' : 'No'),
        'Publicar mensajes: ' + (canPost ? 'Sí' : 'No'),
        'Editar mensajes: ' + (canEdit ? 'Sí' : 'No'),
        'Eliminar mensajes: ' + (canDelete ? 'Sí' : 'No'),
        '',
        isAdmin && canPost ? '✅ El canal está listo para las funciones de publicación que tienen permiso.' : '⚠️ Añade el bot como administrador y concede los permisos necesarios.',
        'Esta prueba no publica ni elimina mensajes.',
      ].join('\n');
      await renderPanel(report, [[{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }]]);
    } catch (error) {
      console.log('Falló la prueba de permisos del canal', channelId, String(error));
      await renderPanel('⚠️ No pude consultar el canal. Comprueba que el ID sea correcto y que el bot siga dentro del canal como administrador. Esta prueba no publicó ningún mensaje.', [
        [{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }],
      ]);
    }
    return;
  }
  if (section === 'channelsettings') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!channel) { await answer(query, 'El canal ya no está registrado.', true); return; }
    const setting = await ensureChannelSettings(channelId);
    await answer(query);
    await renderPanel('⚙️ CONFIGURACIÓN INDIVIDUAL\n\n' + String(channel.title || channelId) + ' (' + channelId + ')\nProcesamiento: ' + (channel.active ? 'ACTIVO' : 'PAUSADO') + '\nBienvenida: ' + (setting?.welcomeEnabled ? 'ON' : 'OFF') + '\nCAPTCHA: ' + (setting?.captchaEnabled ? 'ON' : 'OFF') + '\nCorrección de texto: ' + (setting?.textCorrectionEnabled ? 'ON' : 'OFF') + '\nHashtags: ' + (setting?.hashtags || '(sin configurar)') + '\n\nDesde aquí puedes administrar todo lo que afecta a las publicaciones manuales de este canal. Plantillas, hashtags y botones se guardan por canal y tipo de contenido.', [
      [{ text: '📝 Plantillas de publicaciones', callback_data: 'admin:templatechannel:' + channelId }],
      [{ text: '#️⃣ Hashtags ' + (setting?.hashtags ? '🟢' : '⚪'), callback_data: 'admin:hashtagchannel:' + channelId }],
      [{ text: '🔘 Botones interactivos', callback_data: 'admin:buttonchannel:' + channelId }],
      [{ text: '✍️ Firma personalizada ' + (setting?.signatureEnabled ? '🟢' : '⚪'), callback_data: 'admin:signaturetoggle:' + channelId }],
      [{ text: '🖊️ Editar firma', callback_data: 'admin:signatureedit:' + channelId }, { text: '👁️ Vista previa firma', callback_data: 'admin:signaturepreview:' + channelId }],
      [{ text: '✍️ Corrección ' + (setting?.textCorrectionEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:correction:' + channelId }],
      [{ text: '👋 Bienvenida ' + (setting?.welcomeEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:welcome:' + channelId }, { text: '🧩 CAPTCHA ' + (setting?.captchaEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:captcha:' + channelId }],
      [{ text: '✏️ Editar bienvenida', callback_data: 'admin:welcomeedit:' + channelId }],
      [{ text: '🧪 Probar permisos del canal', callback_data: 'admin:channeltest:' + channelId }],
      [{ text: '🔙 Volver a canales', callback_data: 'admin:channels' }],
    ]);
    return;
  }
  if (section === 'signaturetoggle') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para administrar ese canal.', true); return; }
    const current = await ensureChannelSettings(channelId);
    if (!current) { await answer(query, 'No se pudo inicializar la configuración del canal.', true); return; }
    const enabled = Number(current.signatureEnabled) ? 0 : 1;
    await db.update(channelSettings).set({ signatureEnabled: enabled, updatedAt: Date.now() }).where(eq(channelSettings.channelId, channelId)).run();
    await answer(query, enabled ? 'Firma activada.' : 'Firma desactivada.');
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    await renderPanel('✍️ FIRMA PERSONALIZADA\nCanal: ' + String(channel?.title || channelId) + '\nEstado: ' + (enabled ? 'ACTIVA' : 'DESACTIVADA') + '\nTexto: ' + (current?.signatureText || '(sin configurar)'), [
      [{ text: '🖊️ Editar firma', callback_data: 'admin:signatureedit:' + channelId }, { text: '👁️ Vista previa', callback_data: 'admin:signaturepreview:' + channelId }],
      [{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }],
    ]);
    return;
  }
  if (section === 'signatureedit') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para administrar ese canal.', true); return; }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:signature:' + channelId + ']\n✍️ Responde con el texto de la firma de este canal. Puedes usar varias líneas y variables como {canal} y {fecha}.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('La firma se guarda por canal. Puedes activarla o desactivarla cuando quieras; usa Vista previa para revisar un ejemplo.', [[{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }]]);
    return;
  }
  if (section === 'signaturepreview') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para administrar ese canal.', true); return; }
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    const sampleDate = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const preview = String(setting?.signatureText || '').replace(/\{canal\}/gi, String(channel?.title || channelId)).replace(/\{fecha\}/gi, sampleDate);
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '👁️ VISTA PREVIA DE FIRMA\nCanal: ' + String(channel?.title || channelId) + '\nEstado: ' + (Number(setting?.signatureEnabled) ? 'ACTIVA' : 'DESACTIVADA') + '\n\n' + (preview || '(No hay firma configurada)') });
    await renderPanel('La vista previa es un ejemplo; la firma se añade solo cuando está activada y Telegram permite editar el mensaje.', [[{ text: '🖊️ Editar firma', callback_data: 'admin:signatureedit:' + channelId }], [{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }]]);
    return;
  }

  if (section === 'welcomeedit') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:welcome:' + channelId + ']\n✍️ Responde a este mensaje con el texto completo de bienvenida. Variables: {mencion}, {nombre}, {username}, {userid}, {canal}.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('El texto se guardará solo para este canal.', [
      [{ text: '🔙 Volver a configuración', callback_data: 'admin:channelsettings:' + channelId }],
    ]);
    return;
  }

  if (section === 'buttons') {
    const rows = await managedChannels(userId);
    const keyboard = rows.map(row => [{ text: String(row.title || row.chatId).slice(0, 36), callback_data: 'admin:buttonchannel:' + row.chatId }]);
    keyboard.push(await backRow());
    await renderPanel('🔘 BOTONES POR CANAL\n\nSelecciona el canal al que pertenecen los botones. Se guardan dentro de cada plantilla y no afectan a otros canales.', keyboard);
    return;
  }
  if (section === 'buttonchannel') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    const rows = await db.select().from(templates).where(eq(templates.channelId, channelId)).all();
    const kinds = [['default','⭐ Predeterminada'],['text','💬 Texto'],['photo','🖼️ Fotos'],['video','🎬 Vídeos'],['gif','🎞️ GIF'],['audio','🎧 Audio/voz'],['document','📎 Archivos'],['video_note','🫧 Video burbuja'],['album','🗂️ Álbumes'],['link','🔗 Enlaces'],['forward','↪️ Reenviadas']];
    const keyboard = kinds.map(([kind,label]) => {
      const template = rows.find(row => row.kind === kind);
      let count = 0;
      try { count = JSON.parse(template?.buttonsJson || '[]').reduce((n,row) => n + (Array.isArray(row) ? row.length : 0), 0); } catch {}
      return [{ text: label + ' · ' + (count ? count + ' botón(es)' : 'sin botones'), callback_data: 'admin:buttonkind:' + channelId + ':' + kind }];
    });
    keyboard.push([{ text: '🔙 Volver a canales', callback_data: 'admin:buttons' }]);
    await answer(query);
    await renderPanel('🔘 BOTONES DEL CANAL\n\n' + String(channel?.title || channelId) + ' (' + channelId + ')\nSelecciona el tipo de publicación para consultar, crear o editar su teclado.', keyboard);
    return;
  }
  if (section === 'buttonkind') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo no es válido.', true); return;
    }
    const template = await db.select().from(templates).where(eq(templates.templateKey, channelId + ':' + kind)).get();
    let keyboardData = [];
    try { keyboardData = JSON.parse(template?.buttonsJson || '[]'); } catch {}
    const flat = keyboardData.flat().filter(Boolean);
    const detail = flat.length ? flat.map((button,i) => (i + 1) + '. ' + button.text + ' [' + (button.style || 'normal') + '] — ' + (button.url ? button.url : button.callback_data ? 'acción interna' : button.copy_text?.text ? 'copiar texto' : 'acción especial')).join('\n') : '(sin botones configurados)';
    const individualRows = flat.map((button, index) => [
      { text: '✏️ ' + (index + 1), callback_data: 'admin:buttonedit:' + channelId + ':' + kind + ':' + (index + 1) },
      { text: '🗑️ ' + (index + 1), callback_data: 'admin:buttondelete:' + channelId + ':' + kind + ':' + (index + 1) },
    ]);
    await answer(query);
    await renderPanel('🔘 BOTONES DE LA PLANTILLA\nCanal: ' + channelId + '\nTipo: ' + kind + '\n\n' + detail + '\n\nPulsa editar y responde al mensaje del bot con una línea por fila. Separa botones de la misma fila con |. Ejemplo: Visitar canal - https://t.me/ejemplo\n#g Acceder - https://t.me/ejemplo\n\nEstilos: #p azul, #g verde, #r rojo. Acciones: URL, callback:TEXTO, popup:TEXTO, alert:TEXTO, copy:TEXTO, share:TEXTO. Usa los botones numerados para editar o eliminar individualmente.', [
      ...individualRows,
      [{ text: '➕ Crear/reemplazar teclado completo', callback_data: 'admin:buttoninput:' + channelId + ':' + kind }],
      [{ text: '🗑️ Quitar todos', callback_data: 'admin:buttonclear:' + channelId + ':' + kind }],
      [{ text: '🔙 Volver', callback_data: 'admin:buttonchannel:' + channelId }],
    ]);
    return;
  }
  if (section === 'buttoninput') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo no es válido.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:buttons:' + channelId + ':' + kind + ']\n✍️ Responde a este mensaje con los botones. Una fila por línea; usa | para varias columnas. Ejemplo:\nVisitar canal - https://t.me/ejemplo | #g Acceder - https://t.me/ejemplo', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Los botones se guardarán solo en esta plantilla.', [[{ text: '🔙 Volver', callback_data: 'admin:buttonkind:' + channelId + ':' + kind }]]);
    return;
  }
  if (section === 'buttondelete' || section === 'buttonedit') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || ''); const index = Number(parts[4]);
    if (!Number.isSafeInteger(channelId) || !Number.isSafeInteger(index) || index < 1 ||
        !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) ||
        !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el botón no es válido.', true); return;
    }
    const templateKey = channelId + ':' + kind;
    const template = await db.select().from(templates).where(eq(templates.templateKey, templateKey)).get();
    let rows = [];
    try { rows = JSON.parse(template?.buttonsJson || '[]'); } catch {}
    if (!Array.isArray(rows)) rows = [];
    const flat = rows.flatMap((row, rowIndex) => Array.isArray(row) ? row.map((button, columnIndex) => ({ button, rowIndex, columnIndex })) : []);
    const target = flat[index - 1];
    if (!target || !template) { await answer(query, 'Ese botón ya no existe.', true); return; }
    if (section === 'buttondelete') {
      rows[target.rowIndex].splice(target.columnIndex, 1);
      rows = rows.filter(row => Array.isArray(row) && row.length);
      await db.update(templates).set({ buttonsJson: JSON.stringify(rows), updatedBy: userId, updatedAt: Date.now() }).where(eq(templates.templateKey, templateKey)).run();
      await answer(query, 'Botón eliminado.');
      const flatAfter = rows.flat();
      const keyboard = flatAfter.map((button, i) => [
        { text: '✏️ ' + (i + 1), callback_data: 'admin:buttonedit:' + channelId + ':' + kind + ':' + (i + 1) },
        { text: '🗑️ ' + (i + 1), callback_data: 'admin:buttondelete:' + channelId + ':' + kind + ':' + (i + 1) },
      ]);
      keyboard.push([{ text: '➕ Editar teclado completo', callback_data: 'admin:buttoninput:' + channelId + ':' + kind }]);
      keyboard.push([{ text: '🔙 Volver', callback_data: 'admin:buttonchannel:' + channelId }]);
      await renderPanel('🔘 Botón eliminado. Botones restantes: ' + flatAfter.length, keyboard);
      return;
    }
    await answer(query);
    await api.sendMessage({
      chat_id: chatId,
      text: '[CBINPUT:buttonedit:' + channelId + ':' + kind + ':' + index + ']\n✍️ Responde con la nueva definición de un solo botón. Formato: Texto - URL o Texto - popup:Mensaje.',
      reply_markup: { force_reply: true, selective: true },
    });
    await renderPanel('Editando el botón ' + index + ' de la plantilla ' + kind + '.', [[{ text: '🔙 Volver', callback_data: 'admin:buttonkind:' + channelId + ':' + kind }]]);
    return;
  }
  if (section === 'buttonclear') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo no es válido.', true); return;
    }
    const template = await db.select().from(templates).where(eq(templates.templateKey, channelId + ':' + kind)).get();
    if (template) await db.update(templates).set({ buttonsJson: '[]', updatedAt: Date.now(), updatedBy: userId }).where(eq(templates.templateKey, channelId + ':' + kind)).run();
    await answer(query, 'Botones eliminados.');
    await renderPanel('🔘 No hay botones configurados para ' + kind + '.', [[{ text: '🔙 Volver', callback_data: 'admin:buttonkind:' + channelId + ':' + kind }]]);
    return;
  }
  if (section === 'reactions') {
    const rows = await managedChannels(userId);
    const keyboard = rows.map(row => [{ text: '🔔 ' + String(row.title || row.chatId).slice(0,38), callback_data: 'admin:reactionchannel:' + row.chatId }]);
    keyboard.push(await backRow());
    await answer(query);
    await renderPanel('🔔 REPORTES DE REACCIONES\n\nSelecciona un canal para configurar dónde se envían los avisos.', keyboard);
    return;
  }
  if (section === 'reactionchannel') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para ese canal.', true); return; }
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    await answer(query);
    await renderPanel('🔔 REPORTES DE REACCIONES\nCanal: ' + channelId + '\nDestino actual: ' + (setting?.reactionReportChatId || 'predeterminado') + '\n\nEl destino debe ser un canal donde el bot pueda publicar.', [
      [{ text: '✏️ Cambiar destino', callback_data: 'admin:reactioninput:' + channelId }],
      [{ text: '🔙 Volver', callback_data: 'admin:reactions' }],
    ]);
    return;
  }
  if (section === 'reactioninput') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso para ese canal.', true); return; }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:report:' + channelId + ']\n✍️ Responde con el ID numérico del canal o grupo que recibirá los reportes.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Envía el ID como respuesta al mensaje del bot.', [[{ text: '🔙 Volver', callback_data: 'admin:reactionchannel:' + channelId }]]);
    return;
  }
  // DISTRIBUCIÓN: cada pantalla usa un teclado nuevo, validado y serializable.
  if (section === 'routes') {
    await answer(query);
    try {
      const [routeRows, channelRows] = await Promise.all([
        db.select().from(channelRoutes).all(),
        managedChannels(userId),
      ]);
      const channelNames = new Map(
        channelRows.map(channel => [
          Number(channel.chatId),
          String(channel.title || channel.chatId),
        ]),
      );
      const keyboard = [[
        { text: '➕ Crear ruta', callback_data: 'admin:routeadd' },
      ]];

      for (const route of routeRows) {
        const sourceId = Number(route.sourceChatId);
        const destinationId = Number(route.destinationChatId);
        if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(destinationId)) continue;
        if (!channelNames.has(sourceId) || !channelNames.has(destinationId)) continue;

        const modeLabel = route.mode === 'copy'
          ? 'Copiar'
          : route.mode === 'forward'
            ? 'Reenviar'
            : 'Auto';
        const label = '⚙️ ' + channelNames.get(sourceId).slice(0, 16)
          + ' → ' + channelNames.get(destinationId).slice(0, 16)
          + ' · ' + modeLabel;

        keyboard.push([{
          text: String(label),
          callback_data: 'admin:routedetail:' + sourceId + ':' + destinationId,
        }]);
      }

      keyboard.push([{ text: '🔙 VOLVER', callback_data: 'admin:back' }]);

      // Telegram exige una matriz de filas y objetos con text/callback_data de tipo string.
      const inlineKeyboard = JSON.parse(JSON.stringify(keyboard)).map(row =>
        row.map(button => ({
          text: String(button.text),
          callback_data: String(button.callback_data),
        })),
      );
      if (!inlineKeyboard.every(row => Array.isArray(row) &&
          row.every(button => typeof button.text === 'string' &&
            typeof button.callback_data === 'string'))) {
        throw new Error('El teclado de DISTRIBUCIÓN no superó la validación de botones.');
      }

      await renderPanel(
        '🔀 DISTRIBUCIÓN ENTRE CANALES\n\n'
          + (routeRows.length ? 'Pulsa una ruta para configurar el modo o eliminarla.' : 'Aún no hay rutas configuradas.')
          + '\n\nCada ruta permite copiar, reenviar o usar el modo automático.',
        inlineKeyboard,
      );
    } catch (error) {
      console.log('Error al abrir DISTRIBUCIÓN:', String(error), error?.stack || '');
      const diagnostic = String(error?.message || error || 'Error desconocido')
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 240);
      await sendPanel(
        chatId,
        '⚠️ No se pudo cargar DISTRIBUCIÓN.\n\nDiagnóstico: ' + diagnostic,
        [
          [{ text: '🔄 Reintentar', callback_data: 'admin:routes' }],
          [{ text: '🔙 Volver al panel', callback_data: 'admin:back' }],
        ],
        message?.message_id,
      );
    }
    return;
  }

  if (section === 'routeadd') {
    const rows = await managedChannels(userId);
    const keyboard = rows.map(channel => [{
      text: '📤 ' + String(channel.title || channel.chatId).slice(0, 38),
      callback_data: 'admin:routesource:' + Number(channel.chatId),
    }]);
    keyboard.push([{ text: '🔙 Volver', callback_data: 'admin:routes' }]);
    await answer(query);
    await renderPanel(
      rows.length
        ? '➕ CREAR RUTA\n\nSelecciona el canal de origen.'
        : '⚠️ Primero debes registrar un canal para poder crear una ruta.',
      keyboard,
    );
    return;
  }

  if (section === 'routesource') {
    const sourceId = Number(parts[2]);
    if (!Number.isSafeInteger(sourceId) || !(await canManageChannel(userId, sourceId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true);
      return;
    }
    const rows = (await managedChannels(userId))
      .filter(channel => Number(channel.chatId) !== sourceId);
    const keyboard = rows.map(channel => [{
      text: '📥 ' + String(channel.title || channel.chatId).slice(0, 38),
      callback_data: 'admin:routedest:' + sourceId + ':' + Number(channel.chatId),
    }]);
    keyboard.push([{ text: '🔙 Volver', callback_data: 'admin:routes' }]);
    await answer(query);
    await renderPanel(
      rows.length
        ? 'Selecciona el canal de destino para el origen ' + sourceId + '.'
        : 'No hay otro canal registrado para usar como destino.',
      keyboard,
    );
    return;
  }

  if (section === 'routedest') {
    const sourceId = Number(parts[2]);
    const destinationId = Number(parts[3]);
    if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(destinationId)
        || sourceId === destinationId
        || !(await canManageChannel(userId, sourceId))
        || !(await canManageChannel(userId, destinationId))) {
      await answer(query, 'La ruta no es válida o no tienes permiso.', true);
      return;
    }

    const routeKey = sourceId + ':' + destinationId;
    await db.insert(channelRoutes).values({
      routeKey,
      sourceChatId: sourceId,
      destinationChatId: destinationId,
      mode: 'auto',
      createdBy: userId,
      createdAt: Date.now(),
    }).onConflictDoNothing().run();

    await answer(query, 'Ruta guardada. Elige el modo de envío.');
    // Presentar la elección inmediatamente evita que una ruta recién creada
    // quede sin configurar el comportamiento de envío/reenvío.
    await renderPanel(
      '✅ RUTA CREADA\\n\\nOrigen: ' + sourceId
        + '\\nDestino: ' + destinationId
        + '\\n\\nSelecciona cómo se enviarán las publicaciones nuevas.',
      [
        [{ text: '🔄 Automático', callback_data: 'admin:routemode:' + sourceId + ':' + destinationId + ':auto' }],
        [{ text: '📄 Copiar publicación', callback_data: 'admin:routemode:' + sourceId + ':' + destinationId + ':copy' }],
        [{ text: '↪️ Reenviar publicación', callback_data: 'admin:routemode:' + sourceId + ':' + destinationId + ':forward' }],
        [{ text: '⚙️ Más opciones / eliminar', callback_data: 'admin:routedetail:' + sourceId + ':' + destinationId }],
        [{ text: '🔀 Ver distribuciones', callback_data: 'admin:routes' }],
      ],
    );
    return;
  }

  if (section === 'routedetail') {
    const sourceId = Number(parts[2]);
    const destinationId = Number(parts[3]);
    if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(destinationId)
        || !(await canManageChannel(userId, sourceId))
        || !(await canManageChannel(userId, destinationId))) {
      await answer(query, 'No tienes permiso para administrar esa ruta.', true);
      return;
    }

    const route = await db.select().from(channelRoutes)
      .where(eq(channelRoutes.routeKey, sourceId + ':' + destinationId))
      .get();
    if (!route) {
      await answer(query, 'La ruta ya no existe.', true);
      await renderPanel('La ruta ya no existe.', [
        [{ text: '🔀 Ver distribuciones', callback_data: 'admin:routes' }],
      ]);
      return;
    }

    const mode = ['copy', 'forward'].includes(route.mode) ? route.mode : 'auto';
    const modeLabel = mode === 'copy'
      ? '📄 Copiar (sin encabezado de reenvío)'
      : mode === 'forward'
        ? '↪️ Reenviar (con encabezado de canal)'
        : '🔄 Automático (comportamiento predeterminado)';

    await answer(query);
    await renderPanel(
      '🔀 CONFIGURAR DISTRIBUCIÓN\n\nOrigen: ' + sourceId
        + '\nDestino: ' + destinationId
        + '\nModo actual: ' + modeLabel
        + '\n\nElige cómo se distribuirán las publicaciones nuevas.',
      [
        [{ text: (mode === 'auto' ? '✅ ' : '') + '🔄 Automático', callback_data: 'admin:routemode:' + sourceId + ':' + destinationId + ':auto' }],
        [{ text: (mode === 'copy' ? '✅ ' : '') + '📄 Copiar publicación', callback_data: 'admin:routemode:' + sourceId + ':' + destinationId + ':copy' }],
        [{ text: (mode === 'forward' ? '✅ ' : '') + '↪️ Reenviar publicación', callback_data: 'admin:routemode:' + sourceId + ':' + destinationId + ':forward' }],
        [{ text: '🗑️ Eliminar distribución', callback_data: 'admin:routedelete:' + sourceId + ':' + destinationId }],
        [{ text: '🔙 Volver a distribuciones', callback_data: 'admin:routes' }],
      ],
    );
    return;
  }

  if (section === 'routemode') {
    const sourceId = Number(parts[2]);
    const destinationId = Number(parts[3]);
    const mode = String(parts[4] || '');
    if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(destinationId)
        || !['auto', 'copy', 'forward'].includes(mode)
        || !(await canManageChannel(userId, sourceId))
        || !(await canManageChannel(userId, destinationId))) {
      await answer(query, 'La ruta, el modo o los permisos no son válidos.', true);
      return;
    }

    const routeKey = sourceId + ':' + destinationId;
    const route = await db.select().from(channelRoutes)
      .where(eq(channelRoutes.routeKey, routeKey))
      .get();
    if (!route) {
      await answer(query, 'La ruta ya no existe.', true);
      return;
    }

    await db.update(channelRoutes).set({ mode })
      .where(eq(channelRoutes.routeKey, routeKey)).run();
    await answer(query, 'Modo de distribución actualizado.');
    await renderPanel(
      '✅ Modo actualizado.\n\n' + sourceId + ' → ' + destinationId
        + '\nModo: ' + (mode === 'copy'
          ? 'Copiar sin encabezado de reenvío'
          : mode === 'forward'
            ? 'Reenviar con encabezado de canal'
            : 'Automático'),
      [
        [{ text: '⚙️ Configurar distribución', callback_data: 'admin:routedetail:' + sourceId + ':' + destinationId }],
        [{ text: '🔀 Ver distribuciones', callback_data: 'admin:routes' }],
      ],
    );
    return;
  }

  if (section === 'routedelete') {
    const sourceId = Number(parts[2]);
    const destinationId = Number(parts[3]);
    if (!Number.isSafeInteger(sourceId) || !Number.isSafeInteger(destinationId)
        || !(await canManageChannel(userId, sourceId))
        || !(await canManageChannel(userId, destinationId))) {
      await answer(query, 'No tienes permiso para eliminar esa ruta.', true);
      return;
    }

    await db.delete(channelRoutes)
      .where(eq(channelRoutes.routeKey, sourceId + ':' + destinationId)).run();
    await answer(query, 'Ruta eliminada.');
    await renderPanel('🗑️ Distribución eliminada.', [
      [{ text: '🔀 Ver distribuciones', callback_data: 'admin:routes' }],
      [{ text: '🔙 Volver al panel', callback_data: 'admin:back' }],
    ]);
    return;
  }

  if (section === 'blacklist') {
    const rows = await db.select().from(globalBans).all();
    const keyboard = [
      [{ text: '➕ Bloquear usuario', callback_data: 'admin:blackinput:add' }],
      [{ text: '➖ Quitar bloqueo', callback_data: 'admin:blackinput:remove' }],
      [{ text: '🔄 Actualizar lista', callback_data: 'admin:blacklist' }],
      await backRow(),
    ];
    const list = rows.length ? rows.slice(0,30).map(row => '• ' + row.userId + (row.username ? ' (@' + row.username + ')' : '') + (row.reason ? ' — ' + row.reason : '')).join('\n') : '(lista vacía)';
    await answer(query);
    await renderPanel('🚫 BLACKLIST GLOBAL\n\n' + list + (rows.length > 30 ? '\n… y ' + (rows.length - 30) + ' más.' : '') + '\n\nLos bloqueos se aplican a los canales que administras donde el bot tenga permisos.', keyboard);
    return;
  }
  if (section === 'blackinput') {
    const action = String(parts[2] || '');
    if (!['add','remove'].includes(action)) { await answer(query, 'Acción no válida.', true); return; }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBGLOBAL:black' + action + ']\n' + (action === 'add' ? '✍️ Envía el ID de Telegram o @username y, opcionalmente, el motivo. Ejemplo: 123456789 spam' : '✍️ Envía el ID de Telegram o @username que quieres desbloquear.'), reply_markup: { force_reply: true, selective: true } });
    await renderPanel('La acción se ejecutará al responder al mensaje del bot.', [[{ text: '🔙 Volver', callback_data: 'admin:blacklist' }]]);
    return;
  }
  if (section === 'rules') {
    const rows = await managedChannels(userId);
    const keyboard = rows.map(row => [{ text: '⚙️ ' + String(row.title || row.chatId).slice(0, 38), callback_data: 'admin:rulechannel:' + row.chatId }]);
    keyboard.push(await backRow());
    await answer(query);
    await renderPanel('⚙️ REGLAS AUTOMÁTICAS\n\nSelecciona un canal para configurar sus reglas. Cada canal conserva sus propios ajustes.', keyboard);
    return;
  }
  if (section === 'rulechannel') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    await answer(query);
    await renderPanel('⚙️ REGLAS DEL CANAL\n' + String(channel?.title || channelId) + '\n\nCorrección básica: ' + (setting?.textCorrectionEnabled ? 'ACTIVA' : 'DESACTIVADA') + '\nHashtags: ' + (setting?.hashtags || '(ninguno)') + '\nDescripción: ' + (setting?.descriptionTemplate || '(sin plantilla)') + '\nTexto de respaldo: ' + (setting?.missingDataText || '(sin configurar)'), [
      [{ text: '✍️ Corrección ' + (setting?.textCorrectionEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:correction:' + channelId }],
      [{ text: '#️⃣ Editar hashtags', callback_data: 'admin:hashtagchannel:' + channelId }],
      [{ text: '📝 Editar descripción', callback_data: 'admin:ruleinput:description:' + channelId }],
      [{ text: '🧩 Editar texto de respaldo', callback_data: 'admin:ruleinput:missingdata:' + channelId }],
      [{ text: '🔙 Volver', callback_data: 'admin:rules' }],
    ]);
    return;
  }
  if (section === 'ruleinput') {
    const field = String(parts[2] || '');
    const channelId = Number(parts[3]);
    if (!['description','missingdata'].includes(field) || !Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o la opción no es válida.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:' + field + ':' + channelId + ']\n✍️ Responde a este mensaje con el texto que quieres guardar. Variables disponibles: {contenido}, {texto}, {canal}, {fecha}, {enlace}, {hashtags}.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('La regla se guardará únicamente para este canal.', [[{ text: '🔙 Volver', callback_data: 'admin:rulechannel:' + channelId }]]);
    return;
  }
  if (section === 'templates' || section === 'hashtags') {
    const rows = await managedChannels(userId);
    const title = section === 'templates' ? '📝 PLANTILLAS POR CANAL' : '#️⃣ HASHTAGS POR CANAL';
    const keyboard = rows.map(row => [{
      text: String(row.title || row.chatId).slice(0, 36),
      callback_data: 'admin:' + (section === 'templates' ? 'templatechannel:' : 'hashtagchannel:') + row.chatId,
    }]);
    keyboard.push(await backRow());
    await answer(query);
    await renderPanel(title + '\n\n' + (rows.length ? 'Selecciona un canal para consultar y configurar sus opciones.' : 'No tienes canales registrados.'), keyboard);
    return;
  }
  if (section === 'templatechannel' || section === 'hashtagchannel') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!channel) { await answer(query, 'Canal no encontrado.', true); return; }
    await answer(query);
    if (section === 'hashtagchannel') {
      const settings = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
      await renderPanel('#️⃣ HASHTAGS DEL CANAL\n\nCanal: ' + String(channel.title || channelId) + '\nID: ' + channelId + '\n\nActuales: ' + (settings?.hashtags || '(sin hashtags)'), [
        [{ text: '✏️ Editar hashtags', callback_data: 'admin:hashtagedit:' + channelId }],
        [{ text: '🗑️ Borrar hashtags', callback_data: 'admin:hashtagclear:' + channelId }],
        [{ text: '🔙 Volver a canales', callback_data: 'admin:hashtags' }],
      ]);
    } else {
      const rows = await db.select().from(templates).where(eq(templates.channelId, channelId)).all();
      const kinds = [
        ['default', '⭐ Predeterminada'], ['text', '💬 Texto'], ['photo', '🖼️ Fotografía'], ['video', '🎬 Vídeo'],
        ['gif', '🎞️ GIF'], ['audio', '🎧 Audio/voz'], ['document', '📎 Archivos'], ['video_note', '🫧 Video burbuja'],
        ['album', '🖼️ Álbum'], ['link', '🔗 Enlace'], ['forward', '↪️ Reenviada'],
      ];
      const list = kinds.map(([kind,label]) => {
        const row = rows.find(item => item.kind === kind || (kind === 'text' && item.kind === 'default'));
        return label + ': ' + (row ? 'configurada (' + row.format + ')' : 'sin configurar');
      }).join('\n');
      const keyboard = kinds.map(([kind,label]) => [{ text: label, callback_data: 'admin:templatekind:' + channelId + ':' + kind }]);
      keyboard.push([{ text: '📋 Ver todas las plantillas', callback_data: 'admin:templatelist:' + channelId }]);
      keyboard.push([{ text: '🔙 Volver a canales', callback_data: 'admin:templates' }]);
      await renderPanel('📝 PLANTILLAS DEL CANAL\n\n' + String(channel.title || channelId) + ' (' + channelId + ')\n\n' + list + '\n\nVariables: {canal}, {descripcion}, {titulo}, {enlace}, {hashtags}, {fecha}, {contenido}, {vacio} (también {texto}). {vacio} impide cualquier modificación.', keyboard);
    }
    return;
  }
  if (section === 'hashtagclear') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    await db.update(channelSettings).set({ hashtags: '', updatedAt: Date.now() }).where(eq(channelSettings.channelId, channelId)).run();
    await answer(query, 'Hashtags borrados.');
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    await renderPanel('#️⃣ HASHTAGS DEL CANAL\n\nCanal: ' + String(channel?.title || channelId) + '\nActuales: ' + (setting?.hashtags || '(sin hashtags)'), [
      [{ text: '✏️ Editar hashtags', callback_data: 'admin:hashtagedit:' + channelId }],
      [{ text: '🔙 Volver', callback_data: 'admin:hashtags' }],
    ]);
    return;
  }
  if (section === 'hashtagedit') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:hashtags:' + channelId + ']\n✍️ Responde a este mensaje con los hashtags que quieres añadir automáticamente, por ejemplo: #Noticias #Actualidad.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Envía los hashtags como respuesta al mensaje del bot.', [
      [{ text: '🔙 Volver', callback_data: 'admin:hashtagchannel:' + channelId }],
    ]);
    return;
  }

  if (section === 'templatekind') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    const labels = { default:'⭐ Plantilla predeterminada', text:'💬 Mensajes de texto', photo:'🖼️ Fotografías', video:'🎬 Vídeos', gif:'🎞️ GIF', audio:'🎧 Audio/voz', document:'📎 Archivos', video_note:'🫧 Video burbuja', album:'🖼️ Álbumes', link:'🔗 Enlaces', forward:'↪️ Publicaciones reenviadas' };
    if (!Number.isSafeInteger(channelId) || !Object.hasOwn(labels, kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo de plantilla no es válido.', true);
      return;
    }
    await answer(query);
    await renderPanel('✏️ PLANTILLA: ' + labels[kind] + '\n\n1. Elige el formato.\n2. El bot te pedirá el texto y lo guardarás respondiendo al mensaje.\n\nVariables: {contenido}, {texto}, {titulo}, {descripcion}, {enlace}, {hashtags}, {fecha}, {canal}, {firma}, {vacio}. Si usas {vacio}, el bot conserva el mensaje original sin cambios, hashtags, firma ni botones.', [
      [{ text: 'AUTO', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':AUTO' }, { text: 'HTML', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':HTML' }],
      [{ text: 'Markdown', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':MARKDOWN' }, { text: 'MarkdownV2', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':MARKDOWNV2' }],
      [{ text: 'OFF', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':OFF' }],
      [{ text: 'RICH_MESSAGE', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':RICH_MESSAGE' }],
      [{ text: '👁️ Vista previa', callback_data: 'admin:templatepreview:' + channelId + ':' + kind }],
      [{ text: '📋 Ver guardadas', callback_data: 'admin:templatelist:' + channelId }],
      [{ text: '🔙 Volver', callback_data: 'admin:templatechannel:' + channelId }],
    ]);
    return;
  }
  if (section === 'templatepreview') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) { await answer(query, 'No tienes permiso o el tipo no es válido.', true); return; }
    const template = await db.select().from(templates).where(eq(templates.templateKey, channelId + ':' + kind)).get();
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!template) { await answer(query, 'Primero guarda una plantilla para poder previsualizarla.', true); return; }
    const date = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const samples = { canal: String(channel?.title || channelId), descripcion: 'Descripción de ejemplo', titulo: 'Título de ejemplo', enlace: 'https://t.me/ejemplo', hashtags: String(setting?.hashtags || '#Ejemplo'), fecha: date, contenido: 'Este es un contenido de ejemplo.', texto: 'Este es un contenido de ejemplo.', firma: Number(setting?.signatureEnabled) ? String(setting?.signatureText || '') : '' };
    let preview = String(template.body || '');
    if (/\{vacio\}/i.test(preview)) preview = '⏭️ MODO {vacio}: la publicación original se conserva sin aplicar plantilla, hashtags, firma ni botones.';
    else {
      for (const [key, value] of Object.entries(samples)) preview = preview.replace(new RegExp('\\{' + key + '\\}', 'gi'), String(value));
      if (Number(setting?.signatureEnabled) && setting?.signatureText && !/\{firma\}/i.test(String(template.body || ''))) preview += '\n\n' + setting.signatureText;
      if (setting?.hashtags && !/\{hashtags\}/i.test(String(template.body || ''))) preview += '\n\n' + setting.hashtags;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '👁️ VISTA PREVIA · ' + kind + ' · ' + template.format + '\nCanal: ' + String(channel?.title || channelId) + '\n\n' + preview.slice(0, 3800) });
    await renderPanel('Vista previa de la plantilla ' + kind + '. Es un ejemplo con valores ficticios; el resultado real depende del contenido recibido y de las limitaciones de Telegram.', [[{ text: '✏️ Editar plantilla', callback_data: 'admin:templatekind:' + channelId + ':' + kind }], [{ text: '🔙 Volver', callback_data: 'admin:templatechannel:' + channelId }]]);
    return;
  }
  if (section === 'templateinput') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || ''); const format = String(parts[4] || '').toUpperCase();
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) || !['AUTO','HTML','MARKDOWN','MARKDOWNV2','OFF','RICH_MESSAGE'].includes(format) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'La selección no es válida o no tienes permiso.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:template:' + channelId + ':' + kind + ':' + format + ']\n✍️ Envía el texto completo de la plantilla como respuesta a este mensaje. Puedes incluir varias líneas.\n\nVariables: {contenido}, {texto}, {titulo}, {descripcion}, {enlace}, {hashtags}, {fecha}, {canal}, {firma}, {vacio}.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Cuando envíes la plantilla, quedará guardada únicamente para este canal y tipo de publicación.', [[{ text: '🔙 Volver a plantillas', callback_data: 'admin:templatechannel:' + channelId }]]);
    return;
  }
  if (section === 'templatedelete') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','gif','audio','document','video_note','album','link','forward'].includes(kind) ||
        !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o la plantilla no es válida.', true); return;
    }
    await db.delete(templates).where(eq(templates.templateKey, channelId + ':' + kind)).run();
    await answer(query, 'Plantilla eliminada.');
    const rows = await db.select().from(templates).where(eq(templates.channelId, channelId)).all();
    const keyboard = rows.map(t => [
      { text: '✏️ ' + t.kind, callback_data: 'admin:templatekind:' + channelId + ':' + t.kind },
      { text: '🗑️ ' + t.kind, callback_data: 'admin:templatedelete:' + channelId + ':' + t.kind },
    ]);
    keyboard.push([{ text: '🔙 Volver', callback_data: 'admin:templatechannel:' + channelId }]);
    await renderPanel('📋 PLANTILLAS GUARDADAS\n\n' + (rows.length ? rows.map(t => '• ' + t.kind + ' (' + t.format + '): ' + t.body.slice(0, 100)).join('\n') : 'No hay plantillas configuradas.'), keyboard);
    return;
  }
  if (section === 'templatelist') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const rows = await db.select().from(templates).where(eq(templates.channelId, channelId)).all();
    const keyboard = rows.map(t => [
      { text: '✏️ ' + t.kind, callback_data: 'admin:templatekind:' + channelId + ':' + t.kind },
      { text: '🗑️ ' + t.kind, callback_data: 'admin:templatedelete:' + channelId + ':' + t.kind },
    ]);
    keyboard.push([{ text: '🔙 Volver', callback_data: 'admin:templatechannel:' + channelId }]);
    await answer(query);
    await renderPanel('📋 PLANTILLAS GUARDADAS\n\n' + (rows.length ? rows.map(t => '• ' + t.kind + ' (' + t.format + '): ' + t.body.slice(0, 100)).join('\n') : 'No hay plantillas configuradas.'), keyboard);
    return;
  }

  await answer(query);
  if (section === 'navigation') {
    const keys = Object.keys(NAV_DEFAULTS).filter(key => !['close'].includes(key));
    const keyboard = [];
    for (let i = 0; i < keys.length; i += 3) {
      keyboard.push(await Promise.all(keys.slice(i, i + 3).map(async key => ({
        text: await navText(key),
        callback_data: 'admin:navigationedit:' + key,
      }))));
    }
    keyboard.push([{ text: '🔙 Volver', callback_data: 'admin:back' }]);
    await renderPanel('🧭 TEXTOS DEL PANEL\n\nPulsa la etiqueta que quieres cambiar. Responde al mensaje de edición con el nuevo texto. Escribe DEFAULT para restaurar el texto original.', keyboard);
    return;
  }
  if (section === 'navigationedit') {
    const key = String(parts[2] || '');
    if (!Object.hasOwn(NAV_DEFAULTS, key) || key === 'close') {
      await renderPanel('⚠️ Etiqueta de navegación no válida.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
      return;
    }
    await api.sendMessage({
      chat_id: chatId,
      text: '[CBNAV:' + key + ']\n✍️ Responde con el nuevo texto para esta etiqueta. Escribe DEFAULT para restaurarla.',
      reply_markup: { force_reply: true, selective: true },
    });
    await renderPanel('Editando la etiqueta: ' + key, [[{ text: '🔙 Volver', callback_data: 'admin:navigation' }]]);
    return;
  }
  if (section === 'testmode') {
    const rows = await managedChannels(userId);
    const keyboard = rows.map(row => [{ text: '🧪 ' + String(row.title || row.chatId).slice(0, 45), callback_data: 'admin:channeltest:' + row.chatId }]);
    keyboard.push(await backRow());
    await renderPanel('🧪 MODO DE PRUEBA\n\nSelecciona un canal para comprobar permisos y acceso. Esta prueba no publica ni elimina mensajes y no modifica las publicaciones existentes.', keyboard);
    return;
  }
  if (section === 'channels') {
    const rows = await managedChannels(userId);
    const text = rows.length ? '📣 CANALES REGISTRADOS\n' + rows.map(c => `• ${c.title || 'Sin título'} — ${c.chatId} — ${c.active ? 'activo' : 'inactivo'}`).join('\n') : 'No hay canales registrados.';
    await renderPanel(text + '\n\nPulsa el nombre de un canal para abrir sus opciones, activa/pausa el procesamiento o elimina su configuración. La eliminación requiere confirmación.', channelManagementButtons(rows));
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
    if (section === 'welcome') {
      for (const channel of settingsRows) keyboard.push([{ text: '✏️ Editar bienvenida · ' + String(channel.title || channel.chatId).slice(0, 24), callback_data: 'admin:welcomeedit:' + channel.chatId }]);
    }
    keyboard.push(await backRow());
    await renderPanel((section === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL') + '\nPulsa un canal para activar/desactivar.' + (section === 'welcome' ? '\nUsa los botones de edición para cambiar el texto.' : '\nEl fallo o vencimiento aplica bloqueo permanente.'), keyboard);
    return;
  }
  if (section === 'admins') {
    if (userId !== OWNER_ID) { await renderPanel('👮 Solo el propietario puede gestionar administradores.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]); return; }
    const rows = await db.select().from(admins).all();
    const keyboard = [
      [{ text: '➕ Añadir administrador', callback_data: 'admin:admininput:add' }],
      [{ text: '➖ Quitar administrador', callback_data: 'admin:admininput:remove' }],
      await backRow(),
    ];
    await renderPanel('👮 ADMINISTRADORES\n\n' + (rows.length ? rows.map(a => '• ' + a.userId + ' (' + a.role + ')').join('\n') : 'Sin administradores adicionales.'), keyboard);
    return;
  }
  if (section === 'admininput') {
    if (userId !== OWNER_ID) {
      await renderPanel('⛔ Solo el propietario puede gestionar administradores.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
      return;
    }
    const action = String(parts[2] || '');
    if (!['add','remove'].includes(action)) {
      await renderPanel('⚠️ Acción no válida.', [[{ text: await navText('back'), callback_data: 'admin:admins' }]]);
      return;
    }
    await api.sendMessage({ chat_id: chatId, text: '[CBGLOBAL:admin' + action + ']\n✍️ Responde con el ID numérico de Telegram del usuario.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('El cambio se aplicará al responder al mensaje del bot.', [[{ text: '🔙 Volver', callback_data: 'admin:admins' }]]);
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
    const rows = (await managedChannels(userId)).filter(row => Number(row.active));
    const keyboard = rows.map(row => [{
      text: '⭐ Crear publicación de pago · ' + String(row.title || row.chatId).slice(0, 24),
      callback_data: 'admin:starspublish:' + row.chatId,
    }]);
    keyboard.push([{ text: await navText('back'), callback_data: 'admin:back' }]);
    await renderPanel('⭐ PUBLICACIONES CON TELEGRAM STARS\n\nSelecciona un canal activo. Después responde con PRECIO | contenido de texto. El bot publicará una vista previa y entregará el texto solo tras confirmar el pago. Prueba el flujo antes de ofrecerlo al público.', keyboard);
    return;
  }
  if (section === 'starspublish') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await renderPanel('⛔ No tienes permiso para publicar en ese canal.', [[{ text: await navText('back'), callback_data: 'admin:stars' }]]);
      return;
    }
    const channel = await db.select().from(channels).where(eq(channels.chatId, channelId)).get();
    if (!channel || !Number(channel.active)) {
      await renderPanel('⚠️ El canal no está activo.', [[{ text: await navText('back'), callback_data: 'admin:stars' }]]);
      return;
    }
    await api.sendMessage({
      chat_id: chatId,
      text: '[CBSTAR:' + channelId + ']\n✍️ Responde con PRECIO | texto exclusivo. Ejemplo: 25 | Este es el contenido premium.',
      reply_markup: { force_reply: true, selective: true },
    });
    await renderPanel('La publicación de pago se creará para: ' + String(channel.title || channelId), [[{ text: '🔙 Volver a Stars', callback_data: 'admin:stars' }]]);
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
    await renderPanel(text, [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'help') {
    await renderPanel('📚 AYUDA\n\nCANALES-BOT se administra desde los botones. Abre una sección, elige el canal y sigue las instrucciones que aparecen. Cuando una opción necesite texto, el bot abrirá un mensaje para responder; no hace falta escribir comandos.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
    return;
  }
  await renderPanel('Sección no reconocida.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
  } catch (error) {
    console.log('Error al procesar callback de administración:', String(error), error?.stack || '');
    // Evita que Telegram deje el botón girando indefinidamente cuando falla una consulta o una edición.
    try {
      await api.answerCallbackQuery({
        callback_query_id: query?.id,
        text: 'No se pudo ejecutar esta opción. Intenta de nuevo; el error quedó registrado.',
        show_alert: true,
      });
    } catch (answerError) {
      console.log('No se pudo responder al callback:', String(answerError));
    }
  }
}
