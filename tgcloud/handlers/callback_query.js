import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { admins } from '../schema.js';

const OWNER_ID = 0; // Sustituir por el ID numérico del propietario antes de producción.

async function isAdmin(userId) {
  if (OWNER_ID !== 0 && Number(userId) === OWNER_ID) return true;
  return Boolean(await db.select().from(admins).where(eq(admins.userId, Number(userId))).get());
}

export default async function (query) {
  if (!query?.id) return;
  const data = query.data ?? '';
  const userId = query.from?.id;
  const message = query.message;

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
    if (message?.chat?.id && message?.message_id) {
      await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
    }
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
