import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, channelSettings } from '../schema.js';
import { sendTopicNotification } from '../lib/notifications.js';

const OWNER_ID = 8424447837;
const now = () => Date.now();

export default async function (update) {
  const chat = update?.chat;
  const member = update?.new_chat_member;
  const actorId = Number(update?.from?.id);
  if (!chat?.id || !['channel', 'group', 'supergroup'].includes(chat.type) || !member?.user?.is_bot) return;

  const oldStatus = String(update?.old_chat_member?.status || 'left');
  const newStatus = String(member.status || 'left');
  const wasAdmin = ['administrator', 'creator'].includes(oldStatus);
  const isAdminNow = ['administrator', 'creator'].includes(newStatus);
  const chatTitle = String(chat.title || chat.username || chat.id);

  if (isAdminNow && !wasAdmin) {
    const details = ['🆕 BOT AÑADIDO A UN CHAT', 'Nombre: ' + chatTitle, 'Tipo: ' + chat.type, 'ID: ' + chat.id, 'Añadido por: ' + (actorId || 'No disponible'), 'Permiso: administrador'];
    await sendTopicNotification('new_chat', details.join('\n'));
    await sendTopicNotification('system', '🤖 BOT ACTIVADO EN CHAT\n' + details.slice(1).join('\n'));
  }
  if (!isAdminNow && wasAdmin) {
    const details = ['🚪 BOT RETIRADO O SIN PERMISOS DE ADMINISTRADOR', 'Nombre: ' + chatTitle, 'Tipo: ' + chat.type, 'ID: ' + chat.id, 'Nuevo estado: ' + newStatus];
    await sendTopicNotification('system', details.join('\n'));
    await sendTopicNotification('new_chat', details.join('\n'));
  }

  if (isAdminNow) {
    const chatId = Number(chat.id);
    const title = String(chat.title || chat.username || chatId);
    const addedBy = Number.isSafeInteger(actorId) && actorId > 0 ? actorId : OWNER_ID;
    await db.insert(channels).values({
      chatId, title, addedBy, active: 1, createdAt: now()
    }).onConflictDoUpdate({
      target: channels.chatId,
      set: { title, active: 1 }
    }).run();

    await db.insert(channelSettings).values({
      channelId: chatId,
      welcomeEnabled: 0,
      welcomeText: '👋 ¡Bienvenido, {mencion}!',
      captchaEnabled: 0,
      captchaQuestion: '',
      captchaAnswer: '',
      textCorrectionEnabled: 0,
      hashtags: '',
      descriptionTemplate: '',
      missingDataText: '',
      updatedAt: now()
    }).onConflictDoNothing().run();

    console.log('Canal/grupo detectado y registrado automáticamente:', title, chatId);
    return;
  }

  if (!isAdminNow) {
    try {
      await db.update(channels).set({ active: 0 }).where(eq(channels.chatId, Number(chat.id))).run();
      console.log('Canal/grupo desactivado porque el bot no conserva permisos de administrador:', chat.id, member.status);
    } catch (error) {
      console.log('No se pudo desactivar el canal:', String(error));
    }
  }
}
