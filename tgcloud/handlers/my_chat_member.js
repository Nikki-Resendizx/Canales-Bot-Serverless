import { db } from 'sdk';
import { eq } from 'sdk/db';
import { channels, channelSettings } from '../schema.js';

const OWNER_ID = 8624574996;
const now = () => Date.now();

export default async function (update) {
  const chat = update?.chat;
  const member = update?.new_chat_member;
  const actorId = Number(update?.from?.id);
  if (!chat?.id || !['channel', 'group', 'supergroup'].includes(chat.type) || !member?.user?.is_bot) return;

  if (member.status === 'administrator') {
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
      reactionReportChatId: -1004456932813,
      updatedAt: now()
    }).onConflictDoNothing().run();

    console.log('Canal/grupo detectado y registrado automáticamente:', title, chatId);
    return;
  }

  if (member.status !== 'administrator') {
    try {
      await db.update(channels).set({ active: 0 }).where(eq(channels.chatId, Number(chat.id))).run();
      console.log('Canal/grupo desactivado porque el bot no conserva permisos de administrador:', chat.id, member.status);
    } catch (error) {
      console.log('No se pudo desactivar el canal:', String(error));
    }
  }
}
