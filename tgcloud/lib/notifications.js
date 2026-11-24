import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { notificationTopics } from '../schema.js';

export async function sendTopicNotification(topicKey, text, extra = {}) {
  try {
    const destination = await db.select().from(notificationTopics)
      .where(eq(notificationTopics.topicKey, String(topicKey))).get();
    if (!destination || !Number.isSafeInteger(Number(destination.chatId)) ||
        !Number.isSafeInteger(Number(destination.messageThreadId)) ||
        Number(destination.messageThreadId) <= 0) {
      console.log('No existe destino configurado para el tema de notificaciones', topicKey);
      return false;
    }
    await api.sendMessage({
      chat_id: Number(destination.chatId),
      message_thread_id: Number(destination.messageThreadId),
      text: String(text ?? ''),
      ...extra,
    });
    return true;
  } catch (error) {
    console.log('No se pudo enviar notificación al tema', topicKey, String(error));
    return false;
  }
}
