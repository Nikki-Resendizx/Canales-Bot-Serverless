import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { admins } from '../schema.js';

// IMPORTANTE: sustituye 0 por tu ID numérico de Telegram antes de activar el bot.
const OWNER_ID = 0;

async function isAdmin(userId) {
  if (Number(userId) === OWNER_ID && OWNER_ID !== 0) return true;
  const row = await db.select().from(admins).where(eq(admins.userId, Number(userId))).get();
  return Boolean(row);
}

export default async function (message) {
  if (!message?.chat?.id || !message?.from) return;
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = (message.text ?? '').trim();

  if (text === '/start' || text.startsWith('/start ')) {
    await api.sendMessage({
      chat_id: chatId,
      text: '👋 ¡Bienvenido! Soy Canales Bot.\n\nPuedo ayudarte a administrar publicaciones y canales. Usa /help para ver los comandos disponibles.',
    });
    return;
  }

  if (text === '/help') {
    await api.sendMessage({
      chat_id: chatId,
      text: '📚 COMANDOS\n/start — Iniciar el bot\n/help — Ayuda\n/admin — Panel de administración (solo administradores)\n\nLa configuración avanzada se habilitará por etapas y se probará antes de activar el bot en producción.',
    });
    return;
  }

  if (text === '/admin') {
    if (chatId !== userId || !(await isAdmin(userId))) {
      await api.sendMessage({ chat_id: chatId, text: '⛔ Este panel está disponible solo para administradores en chat privado.' });
      return;
    }
    await api.sendMessage({
      chat_id: chatId,
      text: '⚙️ PANEL DE ADMINISTRACIÓN\n\nBase inicial de Serverless. Los módulos se irán activando después de validar cada flujo.',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📣 Canales', callback_data: 'admin:channels' }, { text: '👋 Bienvenida', callback_data: 'admin:welcome' }, { text: '🧩 CAPTCHA', callback_data: 'admin:captcha' }],
          [{ text: '🚫 Blacklist', callback_data: 'admin:blacklist' }, { text: '🔀 Rutas', callback_data: 'admin:routes' }, { text: '📊 Estadísticas', callback_data: 'admin:stats' }],
          [{ text: '📝 Plantillas', callback_data: 'admin:templates' }, { text: '💳 Stars', callback_data: 'admin:stars' }, { text: '❌ Cerrar', callback_data: 'admin:close' }],
        ],
      },
    });
  }
}
