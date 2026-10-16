import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { admins, captchaSessions } from '../schema.js';

const OWNER_ID = 0; // Sustituir por el ID numérico del propietario antes de producción.

async function isAdmin(userId) {
  if (OWNER_ID !== 0 && Number(userId) === OWNER_ID) return true;
  return Boolean(await db.select().from(admins).where(eq(admins.userId, Number(userId))).get());
}

const MAIN_MENU = [
  [{ text: '📣 Canales', callback_data: 'admin:channels' }, { text: '👋 Bienvenida', callback_data: 'admin:welcome' }, { text: '🧩 CAPTCHA', callback_data: 'admin:captcha' }],
  [{ text: '🚫 Blacklist', callback_data: 'admin:blacklist' }, { text: '🔀 Rutas', callback_data: 'admin:routes' }, { text: '📊 Estadísticas', callback_data: 'admin:stats' }],
  [{ text: '📝 Plantillas', callback_data: 'admin:templates' }, { text: '💳 Stars', callback_data: 'admin:stars' }, { text: '❌ Cerrar', callback_data: 'admin:close' }],
];

export default async function (query) {
  if (!query?.id) return;
  const data = query.data ?? '';
  const userId = query.from?.id;
  const message = query.message;

  if (data.startsWith('captcha:')) {
    const [, rawChatId, rawUserId, chosenAnswer] = data.split(':');
    const chatId = Number(rawChatId);
    const targetUserId = Number(rawUserId);
    if (!Number.isFinite(chatId) || !Number.isFinite(targetUserId) || !message?.chat?.id ||
        Number(message.chat.id) !== chatId || Number(userId) !== targetUserId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Este CAPTCHA no te pertenece.', show_alert: true });
      return;
    }

    const sessionKey = `${chatId}:${targetUserId}`;
    const session = await db.select().from(captchaSessions).where(eq(captchaSessions.sessionKey, sessionKey)).get();
    if (!session) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'El CAPTCHA ya no está activo.', show_alert: true });
      return;
    }

    await api.answerCallbackQuery({ callback_query_id: query.id });
    await db.delete(captchaSessions).where(eq(captchaSessions.sessionKey, sessionKey)).run();
    if (session.expiresAt < Date.now() || String(chosenAnswer) !== String(session.expectedAnswer)) {
      await api.banChatMember({ chat_id: chatId, user_id: targetUserId, revoke_messages: true });
      await api.sendMessage({ chat_id: chatId, text: `🚫 Usuario ${targetUserId} expulsado y bloqueado permanentemente por fallar o dejar vencer el CAPTCHA.` });
      return;
    }
    await api.sendMessage({ chat_id: chatId, text: `✅ Usuario ${targetUserId} verificó el CAPTCHA correctamente.` });
    return;
  }

  if (!data.startsWith('admin:')) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Acción desconocida.' });
    return;
  }
  if (!userId || !(await isAdmin(userId)) || message?.chat?.id !== userId) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'No tienes permiso para usar este panel.', show_alert: true });
    return;
  }

  const section = data.slice('admin:'.length);
  if (section === 'close') {
    await api.answerCallbackQuery({ callback_query_id: query.id });
    if (message?.chat?.id && message?.message_id) await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
    return;
  }
  if (section === 'back') {
    await api.answerCallbackQuery({ callback_query_id: query.id });
    await api.sendMessage({ chat_id: message.chat.id, text: '⚙️ PANEL DE ADMINISTRACIÓN', reply_markup: { inline_keyboard: MAIN_MENU } });
    return;
  }

  const labels = {
    channels: '📣 Canales', welcome: '👋 Bienvenida por canal', captcha: '🧩 CAPTCHA por canal',
    blacklist: '🚫 Blacklist global', routes: '🔀 Rutas entre canales', stats: '📊 Estadísticas',
    templates: '📝 Plantillas', stars: '💳 Publicaciones con Telegram Stars',
  };
  const label = labels[section];
  await api.answerCallbackQuery({ callback_query_id: query.id, text: label ? 'Sección seleccionada' : 'Sección no reconocida.' });
  if (!label || !message?.chat?.id || !message?.message_id) return;
  await api.sendMessage({
    chat_id: message.chat.id,
    text: `${label}\n\n🚧 Esta sección está preparada en el menú, pero su flujo de administración todavía no está implementado. No se han cambiado canales ni configuraciones.`,
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver al panel', callback_data: 'admin:back' }]] },
  });
}
