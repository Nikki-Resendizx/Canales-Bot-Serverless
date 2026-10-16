import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import {
  admins, captchaSessions, channels, channelSettings, channelRoutes,
  templates, globalBans, publications, purchases, reactionReports,
} from '../schema.js';

const OWNER_ID = 8624574996;
const MAIN_MENU = [
  [{ text: '📣 Canales', callback_data: 'admin:channels' }, { text: '👋 Bienvenida', callback_data: 'admin:welcome' }, { text: '🧩 CAPTCHA', callback_data: 'admin:captcha' }],
  [{ text: '🚫 Blacklist', callback_data: 'admin:blacklist' }, { text: '🔀 Rutas', callback_data: 'admin:routes' }, { text: '📝 Plantillas', callback_data: 'admin:templates' }],
  [{ text: '📤 Publicaciones', callback_data: 'admin:publications' }, { text: '🔘 Botones', callback_data: 'admin:buttons' }, { text: '🎨 Formatos', callback_data: 'admin:formats' }],
  [{ text: '🔔 Reacciones', callback_data: 'admin:reactions' }, { text: '💳 Stars', callback_data: 'admin:stars' }, { text: '👮 Admins', callback_data: 'admin:admins' }],
  [{ text: '📊 Estadísticas', callback_data: 'admin:stats' }, { text: '⚙️ Configuración', callback_data: 'admin:settings' }, { text: '❌ Cerrar', callback_data: 'admin:close' }],
];

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
async function sendPanel(chatId, text, keyboard = MAIN_MENU) {
  await api.sendMessage({ chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } });
}
function channelButtons(rows, kind) {
  return rows.map((row) => [{
    text: `${String(row.title || row.chatId).slice(0, 42)} · ${kind === 'welcome' ? 'Bienvenida' : 'CAPTCHA'}: ${Number(kind === 'welcome' ? row.welcomeEnabled : row.captchaEnabled) ? 'ON' : 'OFF'}`,
    callback_data: `admin:toggle:${kind}:${row.chatId}`,
  }]);
}
function backRow() { return [{ text: '⬅️ Volver al panel', callback_data: 'admin:back' }]; }
function moduleText(section) {
  const modules = {
    publications: '📤 PUBLICACIONES\n\nPublicar texto: /publish ID_CANAL texto\nPublicar un mensaje con foto/vídeo/documento: responde a ese mensaje con /publish ID_CANAL\n\nPublicar y registrar el mensaje desde el panel requiere elegir el canal y el contenido. El bot debe ser administrador en el canal.',
    buttons: '🔘 BOTONES INLINE\n\nDefine los botones de una plantilla como JSON: /template_buttons ID_CANAL TIPO JSON\nEjemplo: /template_buttons -100123 default [[{"text":"Abrir","url":"https://t.me/"}]]\nCada botón debe tener text y una url o callback_data. Los botones se adjuntan al publicar usando la plantilla default.',
    formats: '🎨 FORMATOS Y VARIABLES\n\nFormatos disponibles: HTML, Markdown, MarkdownV2 y OFF.\nGuardar plantilla: /template_set ID_CANAL TIPO FORMATO texto\nVariables para plantillas: {texto}. Variables de bienvenida: {mencion}, {nombre}, {username}, {userid}.\nUsa HTML para enlaces, negrita, cursiva, subrayado y código admitidos por Telegram.',
    reactions: '🔔 REPORTES DE REACCIONES\n\nConfigurar canal de avisos: /setreport ID_CANAL ID_CANAL_REPORTE\nSe generan reportes separados: las reacciones individuales identificables se reportan con usuario/ID; los eventos de conteo se reportan como agregados y nunca inventan identidades. Telegram debe enviar los eventos de reacción al bot.',
    settings: '⚙️ CONFIGURACIÓN\n\nAñade el bot como administrador en cada canal/grupo con los permisos necesarios. Registra canales con /addchannel ID título.\nComandos: /help\nLa caché de módulos y la sincronización del webhook las administra Telegram Serverless/GitHub Actions, no un botón ficticio dentro del bot.',
    stars: '💳 TELEGRAM STARS\n\nEl esquema conserva publicaciones y compras. No se mostrará un cobro como activo mientras no esté conectado y probado el flujo de factura, pre-checkout y pago confirmado. No envíes dinero ni publiques ofertas de pago hasta completar esa validación.',
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
    await sendPanel(chatId, '⚙️ PANEL DE ADMINISTRACIÓN\nChannelPosts_RoBot\nSelecciona un módulo.');
    return;
  }
  if (section === 'close') {
    await answer(query);
    if (message?.message_id) await api.deleteMessage({ chat_id: chatId, message_id: message.message_id });
    return;
  }
  if (section === 'back') {
    await answer(query);
    await sendPanel(chatId, '⚙️ PANEL DE ADMINISTRACIÓN\nChannelPosts_RoBot\nSelecciona un módulo.');
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
    keyboard.push(backRow());
    await sendPanel(chatId, (kind === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL') + '\nPulsa un canal para alternar la función.', keyboard);
    return;
  }

  await answer(query);
  if (section === 'channels') {
    const rows = await managedChannels(userId);
    const text = rows.length ? '📣 CANALES REGISTRADOS\n' + rows.map(c => `• ${c.title || 'Sin título'} — ${c.chatId} — ${c.active ? 'activo' : 'inactivo'}`).join('\n') : 'No hay canales registrados.';
    await sendPanel(chatId, text + '\n\nAñadir: /addchannel ID título\nQuitar: /delchannel ID');
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
    keyboard.push(backRow());
    await sendPanel(chatId, (section === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL') + '\nPulsa un canal para activar/desactivar.\n' + (section === 'welcome' ? 'Editar texto: /welcometext ID texto' : 'Fallo o vencimiento aplica bloqueo permanente.'), keyboard);
    return;
  }
  if (section === 'admins') {
    if (userId !== OWNER_ID) { await sendPanel(chatId, '👮 Solo el propietario puede gestionar administradores.', [[{ text: '⬅️ Volver', callback_data: 'admin:back' }]]); return; }
    const rows = await db.select().from(admins).all();
    await sendPanel(chatId, '👮 ADMINISTRADORES\n' + (rows.length ? rows.map(a => `• ${a.userId} (${a.role})`).join('\n') : 'Sin administradores adicionales.') + '\n\nAñadir: /addadmin ID\nEliminar: /deladmin ID', [[{ text: '⬅️ Volver', callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'stats') {
    const [c, r, t, b, p, purchaseRows, reactionRows] = await Promise.all([
      db.select().from(channels).all(), db.select().from(channelRoutes).all(),
      db.select().from(templates).all(), db.select().from(globalBans).all(),
      db.select().from(publications).all(), db.select().from(purchases).all(),
      db.select().from(reactionReports).all(),
    ]);
    await sendPanel(chatId, `📊 ESTADÍSTICAS\nCanales: ${c.length}\nRutas: ${r.length}\nPlantillas: ${t.length}\nBlacklist: ${b.length}\nPublicaciones: ${p.length}\nCompras registradas: ${purchaseRows.length}\nReacciones identificadas registradas: ${reactionRows.length}`, [[{ text: '⬅️ Volver', callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'stars') {
    await sendPanel(chatId, moduleText('stars'), [[{ text: '⬅️ Volver', callback_data: 'admin:back' }]]);
    return;
  }
  const text = moduleText(section);
  if (text) {
    await sendPanel(chatId, text, [[{ text: '📚 Ver comandos', callback_data: 'admin:help' }, { text: '⬅️ Volver', callback_data: 'admin:back' }]]);
    return;
  }
  if (section === 'help') {
    await sendPanel(chatId, 'Comandos generales: /help, /channels, /addchannel, /delchannel, /welcome, /welcometext, /captcha, /setreport, /blacklist_add, /blacklist_remove, /blacklist, /route_add, /route_remove, /routes, /template_set, /template_list, /template_buttons, /template_delete, /publish, /stats, /addadmin y /deladmin.', [[{ text: '⬅️ Volver', callback_data: 'admin:back' }]]);
    return;
  }
  await sendPanel(chatId, 'Sección no reconocida.', [[{ text: '⬅️ Volver', callback_data: 'admin:back' }]]);
}
