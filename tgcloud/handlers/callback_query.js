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
    return row?.body || NAV_DEFAULTS[key] || key;
  } catch (error) {
    console.log('No se pudieron leer los textos de navegación; se usarán valores predeterminados', String(error));
    return NAV_DEFAULTS[key] || key;
  }
}
async function buildMainMenu() {
  const keys = [
    ['channels', 'templates'],
    ['hashtags', 'buttons'],
    ['rules', 'testmode'],
    ['welcome', 'captcha'],
    ['blacklist', 'admins'],
    ['publications', 'stats'],
    ['settings'],
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
    buttons: '🔘 BOTONES POR CANAL\n\nConfigura botones por líneas: /template_buttons ID_CANAL TIPO seguido de las líneas.\nEjemplo:\nVisitar canal - https://t.me/ejemplo\n#g Acceder - https://t.me/ejemplo\nUsa | o && para varias columnas. Estilos: #p azul, #g verde, #r rojo (también #b/#d). Acciones: callback:TEXTO, popup:TEXTO, alert:TEXTO, copy:TEXTO, share:TEXTO, rules. Emoji premium: Texto {emoji:ID}.\nEditar: /button_edit ID TIPO N Texto - acción. Eliminar: /button_delete ID TIPO N. Se adjuntan según la plantilla de publicación.',
    formats: '🎨 FORMATOS Y VARIABLES\n\nFormatos disponibles: HTML, Markdown, MarkdownV2, OFF y RICH_MESSAGE (JSON válido).\nGuardar plantilla: /template_set ID_CANAL TIPO FORMATO texto. Editor: /correction ID on|off, /hashtags ID texto, /description ID texto, /missingdata ID texto\nVariables para plantillas: {texto}. Variables de bienvenida: {mencion}, {nombre}, {username}, {userid}.\nUsa HTML para enlaces, negrita, cursiva, subrayado y código admitidos por Telegram.',
    reactions: '🔔 REPORTES DE REACCIONES\n\nConfigurar canal de avisos: /setreport ID_CANAL ID_CANAL_REPORTE\nSe generan reportes separados: las reacciones individuales identificables se reportan con usuario/ID; los eventos de conteo se reportan como agregados y nunca inventan identidades. Telegram debe enviar los eventos de reacción al bot.',
    settings: '⚙️ CONFIGURACIÓN\n\nAñade el bot como administrador en cada canal/grupo con los permisos necesarios. Registra canales con /addchannel ID título.\nComandos: /help\nLa caché de módulos y la sincronización del webhook las administra Telegram Serverless/GitHub Actions, no un botón ficticio dentro del bot.',
    stars: '💳 TELEGRAM STARS\n\nEl flujo básico está conectado: /publish_paid ID_CANAL PRECIO_STARS texto, o responde a un mensaje para vender su copia. Usa moneda XTR (Telegram Stars). Antes de anunciarlo, haz una compra de prueba; los reembolsos todavía no están implementados.',
    blacklist: '🚫 BLACKLIST GLOBAL\n\nAñadir: /blacklist_add ID [@usuario] [motivo]\nQuitar: /blacklist_remove ID\nConsultar: /blacklist\nLos baneos se aplican al entrar en grupos donde el bot tenga permiso de banear.',
    routes: '🔀 RUTAS ENTRE CANALES\n\nCrear: /route_add ID_ORIGEN ID_DESTINO\nEliminar: /route_remove ID_ORIGEN ID_DESTINO\nConsultar: /routes\nEl bot necesita permiso de lectura en el origen y publicación en el destino. Las rutas solo operan en canales registrados.',
    templates: '📝 PLANTILLAS\n\nCrear/editar: /template_set ID_CANAL TIPO FORMATO texto\nListar: /template_list ID_CANAL\nBotones: /template_buttons ID_CANAL TIPO JSON\nEliminar: /template_delete ID_CANAL TIPO\nLa plantilla default se usa para publicar con /publish.',\n    rules: '⚙️ REGLAS AUTOMÁTICAS\n\nConfigura por canal:\n/correction ID on|off — normalización básica de texto\n/hashtags ID #Etiqueta1 #Etiqueta2 — hashtags automáticos\n/description ID plantilla con {texto} — plantilla de descripción\n/missingdata ID texto — texto alternativo si falta contenido\n\nEstas reglas se aplican cuando publicas con /publish. Guarda primero los cambios y prueba antes de publicar contenido real.',
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
      ].join('\\n');
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
    const setting = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    await answer(query);
    await renderPanel('⚙️ CONFIGURACIÓN INDIVIDUAL\\n\\n' + String(channel.title || channelId) + ' (' + channelId + ')\\nProcesamiento: ' + (channel.active ? 'ACTIVO' : 'PAUSADO') + '\\nBienvenida: ' + (setting?.welcomeEnabled ? 'ON' : 'OFF') + '\\nCAPTCHA: ' + (setting?.captchaEnabled ? 'ON' : 'OFF') + '\\nCorrección de texto: ' + (setting?.textCorrectionEnabled ? 'ON' : 'OFF') + '\\n\\nCada opción se guarda por separado para este canal.', [
      [{ text: '👋 Bienvenida ' + (setting?.welcomeEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:welcome:' + channelId }],
      [{ text: '🧩 CAPTCHA ' + (setting?.captchaEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:captcha:' + channelId }],
      [{ text: '✍️ Corrección ' + (setting?.textCorrectionEnabled ? '🟢' : '⚪'), callback_data: 'admin:toggle:correction:' + channelId }],
      [{ text: '✏️ Editar bienvenida', callback_data: 'admin:welcomeedit:' + channelId }],
      [{ text: '🧪 Probar permisos del canal', callback_data: 'admin:channeltest:' + channelId }],
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
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:welcome:' + channelId + ']\\n✍️ Responde a este mensaje con el texto completo de bienvenida. Variables: {mencion}, {nombre}, {username}, {userid}, {canal}.', reply_markup: { force_reply: true, selective: true } });
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
    const kinds = [['default','⭐ Predeterminada'],['text','💬 Texto'],['photo','🖼️ Fotos'],['video','🎬 Vídeos'],['album','🗂️ Álbumes'],['link','🔗 Enlaces'],['forward','↪️ Reenviadas']];
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
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo no es válido.', true); return;
    }
    const template = await db.select().from(templates).where(eq(templates.templateKey, channelId + ':' + kind)).get();
    let keyboardData = [];
    try { keyboardData = JSON.parse(template?.buttonsJson || '[]'); } catch {}
    const flat = keyboardData.flat().filter(Boolean);
    const detail = flat.length ? flat.map((button,i) => (i + 1) + '. ' + button.text + ' [' + (button.style || 'normal') + '] — ' + (button.url ? button.url : button.callback_data ? 'acción interna' : button.copy_text?.text ? 'copiar texto' : 'acción especial')).join('\\n') : '(sin botones configurados)';
    await answer(query);
    await renderPanel('🔘 BOTONES DE LA PLANTILLA\\nCanal: ' + channelId + '\\nTipo: ' + kind + '\\n\\n' + detail + '\\n\\nPulsa editar y responde al mensaje del bot con una línea por fila. Separa botones de la misma fila con |. Ejemplo: Visitar canal - https://t.me/ejemplo\\n#g Acceder - https://t.me/ejemplo\\n\\nEstilos: #p azul, #g verde, #r rojo. Acciones: URL, callback:TEXTO, popup:TEXTO, copy:TEXTO, share:TEXTO, rules.', [
      [{ text: '✏️ Editar botones', callback_data: 'admin:buttoninput:' + channelId + ':' + kind }],
      [{ text: '🗑️ Quitar todos', callback_data: 'admin:buttonclear:' + channelId + ':' + kind }],
      [{ text: '🔙 Volver', callback_data: 'admin:buttonchannel:' + channelId }],
    ]);
    return;
  }
  if (section === 'buttoninput') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo no es válido.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:buttons:' + channelId + ':' + kind + ']\\n✍️ Responde a este mensaje con los botones. Una fila por línea; usa | para varias columnas. Ejemplo:\\nVisitar canal - https://t.me/ejemplo | #g Acceder - https://t.me/ejemplo', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Los botones se guardarán solo en esta plantilla.', [[{ text: '🔙 Volver', callback_data: 'admin:buttonkind:' + channelId + ':' + kind }]]);
    return;
  }
  if (section === 'buttonclear') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','album','link','forward'].includes(kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo no es válido.', true); return;
    }
    const template = await db.select().from(templates).where(eq(templates.templateKey, channelId + ':' + kind)).get();
    if (template) await db.update(templates).set({ buttonsJson: '[]', updatedAt: Date.now(), updatedBy: userId }).where(eq(templates.templateKey, channelId + ':' + kind)).run();
    await answer(query, 'Botones eliminados.');
    await renderPanel('🔘 No hay botones configurados para ' + kind + '.', [[{ text: '🔙 Volver', callback_data: 'admin:buttonkind:' + channelId + ':' + kind }]]);
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
    const list = rows.length ? rows.slice(0,30).map(row => '• ' + row.userId + (row.username ? ' (@' + row.username + ')' : '') + (row.reason ? ' — ' + row.reason : '')).join('\\n') : '(lista vacía)';
    await answer(query);
    await renderPanel('🚫 BLACKLIST GLOBAL\\n\\n' + list + (rows.length > 30 ? '\\n… y ' + (rows.length - 30) + ' más.' : '') + '\\n\\nLos bloqueos se aplican a los canales que administras donde el bot tenga permisos.', keyboard);
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
    await renderPanel('⚙️ REGLAS AUTOMÁTICAS\\n\\nSelecciona un canal para configurar sus reglas. Cada canal conserva sus propios ajustes.', keyboard);
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
    await renderPanel('⚙️ REGLAS DEL CANAL\\n' + String(channel?.title || channelId) + '\\n\\nCorrección básica: ' + (setting?.textCorrectionEnabled ? 'ACTIVA' : 'DESACTIVADA') + '\\nHashtags: ' + (setting?.hashtags || '(ninguno)') + '\\nDescripción: ' + (setting?.descriptionTemplate || '(sin plantilla)') + '\\nTexto de respaldo: ' + (setting?.missingDataText || '(sin configurar)'), [
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
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:' + field + ':' + channelId + ']\\n✍️ Responde a este mensaje con el texto que quieres guardar. Variables disponibles: {contenido}, {texto}, {canal}, {fecha}, {enlace}, {hashtags}.', reply_markup: { force_reply: true, selective: true } });
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
    await renderPanel(title + '\\n\\n' + (rows.length ? 'Selecciona un canal para consultar y configurar sus opciones.' : 'No tienes canales registrados.'), keyboard);
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
      await renderPanel('#️⃣ HASHTAGS DEL CANAL\\n\\nCanal: ' + String(channel.title || channelId) + '\\nID: ' + channelId + '\\n\\nActuales: ' + (settings?.hashtags || '(sin hashtags)'), [
        [{ text: '✏️ Editar hashtags', callback_data: 'admin:hashtagedit:' + channelId }],
        [{ text: '🗑️ Borrar hashtags', callback_data: 'admin:hashtagclear:' + channelId }],
        [{ text: '🔙 Volver a canales', callback_data: 'admin:hashtags' }],
      ]);
    } else {
      const rows = await db.select().from(templates).where(eq(templates.channelId, channelId)).all();
      const kinds = [
        ['text', '💬 Texto'], ['photo', '🖼️ Fotografía'], ['video', '🎬 Vídeo'],
        ['album', '🖼️ Álbum'], ['link', '🔗 Enlace'], ['forward', '↪️ Reenviada'],
      ];
      const list = kinds.map(([kind,label]) => {
        const row = rows.find(item => item.kind === kind || (kind === 'text' && item.kind === 'default'));
        return label + ': ' + (row ? 'configurada (' + row.format + ')' : 'sin configurar');
      }).join('\\n');
      const keyboard = kinds.map(([kind,label]) => [{ text: label, callback_data: 'admin:templatekind:' + channelId + ':' + kind }]);
      keyboard.push([{ text: '📋 Ver todas las plantillas', callback_data: 'admin:templatelist:' + channelId }]);
      keyboard.push([{ text: '🔙 Volver a canales', callback_data: 'admin:templates' }]);
      await renderPanel('📝 PLANTILLAS DEL CANAL\\n\\n' + String(channel.title || channelId) + ' (' + channelId + ')\\n\\n' + list + '\\n\\nVariables: {contenido}, {titulo}, {descripcion}, {enlace}, {hashtags}, {fecha}, {canal}.', keyboard);
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
    await renderPanel('#️⃣ HASHTAGS DEL CANAL\\n\\nCanal: ' + String(channel?.title || channelId) + '\\nActuales: ' + (setting?.hashtags || '(sin hashtags)'), [
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
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:hashtags:' + channelId + ']\\n✍️ Responde a este mensaje con los hashtags que quieres añadir automáticamente, por ejemplo: #Noticias #Actualidad.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Envía los hashtags como respuesta al mensaje del bot.', [
      [{ text: '🔙 Volver', callback_data: 'admin:hashtagchannel:' + channelId }],
    ]);
    return;
  }

  if (section === 'templatekind') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || '');
    const labels = { text:'💬 Mensajes de texto', photo:'🖼️ Fotografías', video:'🎬 Vídeos', album:'🖼️ Álbumes', link:'🔗 Enlaces', forward:'↪️ Publicaciones reenviadas' };
    if (!Number.isSafeInteger(channelId) || !Object.hasOwn(labels, kind) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso o el tipo de plantilla no es válido.', true);
      return;
    }
    await answer(query);
    await renderPanel('✏️ PLANTILLA: ' + labels[kind] + '\\n\\n1. Elige el formato.\\n2. El bot te pedirá el texto y lo guardarás respondiendo al mensaje.\\n\\nVariables: {contenido}, {texto}, {titulo}, {descripcion}, {enlace}, {hashtags}, {fecha}, {canal}.', [
      [{ text: 'HTML', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':HTML' }, { text: 'Markdown', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':MARKDOWN' }],
      [{ text: 'MarkdownV2', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':MARKDOWNV2' }, { text: 'OFF', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':OFF' }],
      [{ text: 'RICH_MESSAGE', callback_data: 'admin:templateinput:' + channelId + ':' + kind + ':RICH_MESSAGE' }],
      [{ text: '📋 Ver guardadas', callback_data: 'admin:templatelist:' + channelId }],
      [{ text: '🔙 Volver', callback_data: 'admin:templatechannel:' + channelId }],
    ]);
    return;
  }
  if (section === 'templateinput') {
    const channelId = Number(parts[2]); const kind = String(parts[3] || ''); const format = String(parts[4] || '').toUpperCase();
    if (!Number.isSafeInteger(channelId) || !['default','text','photo','video','album','link','forward'].includes(kind) || !['HTML','MARKDOWN','MARKDOWNV2','OFF','RICH_MESSAGE'].includes(format) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'La selección no es válida o no tienes permiso.', true); return;
    }
    await answer(query);
    await api.sendMessage({ chat_id: chatId, text: '[CBINPUT:template:' + channelId + ':' + kind + ':' + format + ']\\n✍️ Envía el texto completo de la plantilla como respuesta a este mensaje. Puedes incluir varias líneas.\\n\\nVariables: {contenido}, {texto}, {titulo}, {descripcion}, {enlace}, {hashtags}, {fecha}, {canal}.', reply_markup: { force_reply: true, selective: true } });
    await renderPanel('Cuando envíes la plantilla, quedará guardada únicamente para este canal y tipo de publicación.', [[{ text: '🔙 Volver a plantillas', callback_data: 'admin:templatechannel:' + channelId }]]);
    return;
  }
  if (section === 'templatelist') {
    const channelId = Number(parts[2]);
    if (!Number.isSafeInteger(channelId) || !(await canManageChannel(userId, channelId))) {
      await answer(query, 'No tienes permiso para administrar ese canal.', true); return;
    }
    const rows = await db.select().from(templates).where(eq(templates.channelId, channelId)).all();
    await answer(query);
    await renderPanel('📋 PLANTILLAS GUARDADAS\\n\\n' + (rows.length ? rows.map(t => '• ' + t.kind + ' (' + t.format + '): ' + t.body.slice(0, 140)).join('\\n') : 'No hay plantillas configuradas.') + '\\n\\nEliminar una: /template_delete ' + channelId + ' TIPO', [
      [{ text: '🔙 Volver', callback_data: 'admin:templatechannel:' + channelId }],
    ]);
    return;
  }

  await answer(query);
  if (section === 'navigation') {
    await renderPanel('🧭 TEXTOS DE NAVEGACIÓN\n\nUsa /navtexts para consultar las claves. Edita con /navtext CLAVE nuevo texto. Para restaurar: /navtext CLAVE default.\n\nClaves: panel_title, panel_description, channels, welcome, captcha, hashtags, blacklist, routes, templates, publications, buttons, formats, rules, testmode, reactions, stars, admins, stats, settings, navigation, back.', [[{ text: await navText('back'), callback_data: 'admin:back' }]]);
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
