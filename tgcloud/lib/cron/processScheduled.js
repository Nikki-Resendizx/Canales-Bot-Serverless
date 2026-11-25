import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import {
  channels, scheduledPublications, scheduledPublicationTargets,
  recipientListItems, repeatJobs, forwardHistory,
} from '../../schema.js';
import { sendWithFloodProtection } from '../forwarding.js';

const MAX_PER_TICK = 40;

function parsePayload(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default async function (_args = {}, tick = {}) {
  const now = Date.now();
  const dueRows = (await db.select().from(scheduledPublications).all())
    .filter(row => row.status === 'pending' && Number(row.dueAt) <= now)
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
    .slice(0, MAX_PER_TICK);

  const registered = await db.select().from(channels).all();
  const activeChannels = new Set(registered.filter(row => Number(row.active)).map(row => Number(row.chatId)));
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const schedule of dueRows) {
    const sourceId = Number(schedule.sourceChatId);
    const sourceMessageId = Number(schedule.sourceMessageId);
    const targets = await db.select().from(scheduledPublicationTargets)
      .where(eq(scheduledPublicationTargets.scheduleKey, schedule.scheduleKey)).all();
    let destinations = targets.map(row => Number(row.destinationChatId));

    // Compatibilidad con las programaciones antiguas que guardan un destino directo.
    if (!destinations.length && Number(schedule.destinationChatId)) {
      destinations = [Number(schedule.destinationChatId)];
    }

    // Si la programación referencia una lista en payloadJson, se expande en el tick.
    const payload = parsePayload(schedule.payloadJson);
    if (payload.recipientListKey) {
      const items = await db.select().from(recipientListItems)
        .where(eq(recipientListItems.listKey, String(payload.recipientListKey))).all();
      destinations.push(...items.map(row => Number(row.chatId)));
    }
    destinations = [...new Set(destinations)].filter(id =>
      Number.isSafeInteger(id) && id !== sourceId && activeChannels.has(id));

    if (!activeChannels.has(sourceId) || !destinations.length) {
      skipped++;
      await db.update(scheduledPublications).set({
        status: 'failed', processedAt: now,
      }).where(eq(scheduledPublications.scheduleKey, schedule.scheduleKey)).run();
      continue;
    }

    const mode = ['copy', 'forward'].includes(payload.mode) ? payload.mode : 'copy';
    let scheduleFailed = false;
    for (const destinationId of destinations) {
      const historyKey = String(schedule.scheduleKey) + ':' + String(schedule.dueAt) + ':' + String(destinationId);
      const existing = await db.select().from(forwardHistory)
        .where(eq(forwardHistory.historyKey, historyKey)).get();
      if (existing) continue;

      try {
        const delivery = await sendWithFloodProtection(
          () => mode === 'forward'
            ? api.forwardMessage({
                chat_id: destinationId,
                from_chat_id: sourceId,
                message_id: sourceMessageId,
              })
            : api.copyMessage({
                chat_id: destinationId,
                from_chat_id: sourceId,
                message_id: sourceMessageId,
              }),
          { lastSentAt: 0, minIntervalMs: 1100, maxRetries: 2 },
        );
        await db.insert(forwardHistory).values({
          historyKey,
          routeKey: 'schedule:' + String(schedule.scheduleKey),
          sourceMessageId,
          destinationMessageId: Number(delivery.result?.message_id || 0) || null,
          status: 'sent',
          createdAt: Date.now(),
        }).onConflictDoNothing().run();
        sent++;
      } catch (error) {
        scheduleFailed = true;
        failed++;
        console.log('Scheduled delivery failed', schedule.scheduleKey, destinationId, String(error));
        await db.insert(forwardHistory).values({
          historyKey,
          routeKey: 'schedule:' + String(schedule.scheduleKey),
          sourceMessageId,
          destinationMessageId: null,
          status: 'failed',
          createdAt: Date.now(),
        }).onConflictDoNothing().run();
      }
    }

    const repeat = await db.select().from(repeatJobs)
      .where(eq(repeatJobs.scheduleKey, schedule.scheduleKey)).get();
    if (repeat && Number(repeat.active)) {
      const interval = Math.max(1, Number(repeat.intervalMinutes)) * 60_000;
      const nextAt = Math.max(Number(schedule.dueAt) + interval, Number(repeat.nextRunAt) || 0);
      const remaining = Number(repeat.remainingRuns) || 0;
      if (remaining === -1 || remaining > 0) {
        await db.update(scheduledPublications).set({
          dueAt: nextAt, status: 'pending', processedAt: now,
        }).where(eq(scheduledPublications.scheduleKey, schedule.scheduleKey)).run();
        await db.update(repeatJobs).set({
          nextRunAt: nextAt + interval,
          remainingRuns: remaining > 0 ? remaining - 1 : -1,
        }).where(eq(repeatJobs.repeatKey, repeat.repeatKey)).run();
      } else {
        await db.update(repeatJobs).set({ active: 0, remainingRuns: 0 })
          .where(eq(repeatJobs.repeatKey, repeat.repeatKey)).run();
        await db.update(scheduledPublications).set({
          status: scheduleFailed ? 'failed' : 'sent', processedAt: now,
        }).where(eq(scheduledPublications.scheduleKey, schedule.scheduleKey)).run();
      }
    } else {
      await db.update(scheduledPublications).set({
        status: scheduleFailed ? 'failed' : 'sent', processedAt: now,
      }).where(eq(scheduledPublications.scheduleKey, schedule.scheduleKey)).run();
    }
  }

  return { due: dueRows.length, sent, failed, skipped, runId: tick.runId || null };
}
