import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { publications } from '../schema.js';

export default async function (query) {
  if (!query?.id) return;
  const payload = String(query.invoice_payload ?? '');
  const publication = await db.select().from(publications)
    .where(eq(publications.publicationKey, payload)).get();

  const valid = Boolean(
    publication &&
    publication.status === 'paid' &&
    Number(publication.starsPrice) > 0 &&
    String(query.currency) === 'XTR' &&
    Number(query.total_amount) === Number(publication.starsPrice)
  );

  await api.answerPreCheckoutQuery({
    pre_checkout_query_id: query.id,
    ok: valid,
    ...(!valid ? { error_message: 'Esta publicación ya no está disponible o el precio cambió. Vuelve al bot e inténtalo de nuevo.' } : {}),
  });
}
