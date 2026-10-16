import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { admins, captchaSessions, channels, channelSettings, channelRoutes, templates, globalBans, publications, purchases } from '../schema.js';

const OWNER_ID = 8624574996;
const MAIN_MENU = [
  [{ text: '📣 Canales', callback_data: 'admin:channels' }, { text: '👋 Bienvenida', callback_data: 'admin:welcome' }, { text: '🧩 CAPTCHA', callback_data: 'admin:captcha' }],
  [{ text: '🚫 Blacklist', callback_data: 'admin:blacklist' }, { text: '🔀 Rutas', callback_data: 'admin:routes' }, { text: '📊 Estadísticas', callback_data: 'admin:stats' }],
  [{ text: '📝 Plantillas', callback_data: 'admin:templates' }, { text: '💳 Stars', callback_data: 'admin:stars' }, { text: '👮 Admins', callback_data: 'admin:admins' }],
  [{ text: '❌ Cerrar', callback_data: 'admin:close' }],
];

async function isAdmin(userId) {
  if (Number(userId) === OWNER_ID) return true;
  return Boolean(await db.select().from(admins).where(eq(admins.userId, Number(userId))).get());
}
async function answer(query, text = '') {
  await api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
}
async function sendPanel(chatId, text, keyboard = MAIN_MENU) {
  await api.sendMessage({ chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } });
}
function channelButtons(rows, kind) {
  return rows.map((row) => [{ text: `${row.title || row.chatId} · ${kind === 'welcome' ? 'Bienvenida' : 'CAPTCHA'}`, callback_data: `admin:toggle:${kind}:${row.chatId}` }]);
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
    if (!Number.isFinite(targetChatId) || !Number.isFinite(targetUserId) ||
        chatId !== targetChatId || userId !== targetUserId) {
      await answer(query, 'Este CAPTCHA no te pertenece.');
      return;
    }
    const sessionKey = `${targetChatId}:${targetUserId}`;
    const session = await db.select().from(captchaSessions).where(eq(captchaSessions.sessionKey, sessionKey)).get();
    if (!session) { await answer(query, 'El CAPTCHA ya no está activo.'); return; }
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

  if (section === 'close') {
    await answer(query);
    if (message?.message_id) await api.deleteMessage({ chat_id: chatId, message_id: message.message_id });
    return;
  }
  if (section === 'back') {
    await answer(query);
    await sendPanel(chatId, '⚙️ PANEL DE ADMINISTRACIÓN\nSelecciona un módulo.');
    return;
  }
  if (section === 'toggle') {
    const kind = parts[2];
    const channelId = Number(parts[3]);
    if (!Number.isSafeInteger(channelId) || !['welcome', 'captcha'].includes(kind)) {
      await answer(query, 'Configuración no válida.');
      return;
    }
    const row = await db.select().from(channelSettings).where(eq(channelSettings.channelId, channelId)).get();
    if (!row) { await answer(query, 'Primero registra el canal con /addchannel ID título.'); return; }
    const column = kind === 'welcome' ? 'welcomeEnabled' : 'captchaEnabled';
    const enabled = Number(row[column]) ? 0 : 1;
    await db.update(channelSettings).set({ [column]: enabled, updatedAt: Date.now() }).where(eq(channelSettings.channelId, channelId)).run();
    await answer(query, `${kind === 'welcome' ? 'Bienvenida' : 'CAPTCHA'} ${enabled ? 'activado' : 'desactivado'}`);
    const rows = await db.select().from(channels).all();
    const label = kind === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL';
    const keyboard = channelButtons(rows, kind);
    keyboard.push([{ text: '⬅️ Volver', callback_data: 'admin:back' }]);
    await sendPanel(chatId, label + '\nPulsa un canal para alternar la función.', keyboard);
    return;
  }

  await answer(query);
  if (section === 'channels') {
    const rows = await db.select().from(channels).all();
    const text = rows.length ? '📣 CANALES REGISTRADOS\n' + rows.map(c => `• ${c.title || 'Sin título'} — ${c.chatId} — ${c.active ? 'activo' : 'inactivo'}`).join('\n') : 'No hay canales registrados.';
    await sendPanel(chatId, text + '\n\nAñadir: /addchannel ID título\nQuitar: /delchannel ID');
    return;
  }
  if (section === 'welcome' || section === 'captcha') {
    const rows = await db.select().from(channels).all();
    const keyboard = channelButtons(rows, section);
    keyboard.push([{ text: '⬅️ Volver', callback_data: 'admin:back' }]);
    await sendPanel(chatId, (section === 'welcome' ? '👋 BIENVENIDA POR CANAL' : '🧩 CAPTCHA POR CANAL') + '\nPulsa un canal para activar/desactivar.\n' + (section === 'welcome' ? 'Editar texto: /welcometext ID texto' : 'Fallo o vencimiento aplica bloqueo permanente.'), keyboard);
    return;
  }
  if (section === 'blacklist') {
    const rows = await db.select().from(globalBans).all();
    await sendPanel(chatId, `🚫 BLACKLIST GLOBAL\nRegistros: ${rows.length}\n\nAñadir: /blacklist_add ID @usuario motivo\nQuitar: /blacklist_remove ID\nConsultar: /blacklist`);
    return;
  }
  if (section === 'routes') {
    const rows = await db.select().from(channelRoutes).all();
    await sendPanel(chatId, (rows.length ? '🔀 RUTAS\n' + rows.map(r => `${r.sourceChatId} → ${r.destinationChatId}`).join('\n') : 'No hay rutas configuradas.') + '\n\nCrear: /route_add ORIGEN DESTINO\nEliminar: /route_remove ORIGEN DESTINO');
    return;
  }
  if (section === 'templates') {
    const rows = await db.select().from(templates).all();
    await sendPanel(chatId, `📝 PLANTILLAS\nGuardadas: ${rows.length}\n\nCrear/actualizar:\n/template_set ID_CANAL TIPO FORMATO texto\n\nFormatos: HTML, Markdown, MarkdownV2, OFF\nListar: /template_list ID_CANAL\nPublicar texto: /publish ID_CANAL texto`);
    return;
  }
  if (section === 'stats') {
    const [c, r, t, b, p, purchasesRows] = await Promise.all([
      db.select().from(channels).all(), db.select().from(channelRoutes).all(),
      db.select().from(templates).all(), db.select().from(globalBans).all(),
      db.select().from(publications).all(), db.select().from(purchases).all(),
    ]);
    await sendPanel(chatId, `📊 ESTADÍSTICAS\nCanales: ${c.length}\nRutas: ${r.length}\nPlantillas: ${t.length}\nBlacklist: ${b.length}\nPublicaciones: ${p.length}\nCompras: ${purchasesRows.length}`);
    return;
  }
  if (section === 'admins') {
    if (userId !== OWNER_ID) { await sendPanel(chatId, '👮 Solo el propietario puede gestionar administradores.'); return; }
    const rows = await db.select().from(admins).all();
    await sendPanel(chatId, '👮 ADMINISTRADORES\n' + (rows.length ? rows.map(a => `• ${a.userId} (${a.role})`).join('\n') : 'Sin administradores adicionales.') + '\n\nAñadir: /addadmin ID\nEliminar: /deladmin ID');
    return;
  }
  if (section === 'stars') {
    await sendPanel(chatId, '💳 TELEGRAM STARS\nEl esquema ya registra publicaciones y compras, pero el cobro real requiere que este despliegue soporte y registre los eventos de pagos (invoice, pre-checkout y successful payment). No se activará un cobro simulado. Por ahora publica texto con /publish ID_CANAL texto.');
    return;
  }
  await sendPanel(chatId, 'Sección no reconocida.');
}
