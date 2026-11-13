import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilterConfig, evaluateFilters, localDateKey, mergeFilterConfigs } from '../tgcloud/lib/message_filters.js';

test('whitelist requires a configured phrase and ignores case by default', () => {
  const config = defaultFilterConfig();
  config.whitelist = { enabled: true, words: ['oferta especial'], mode: 'any' };
  assert.equal(evaluateFilters({ text: 'OFERTA ESPECIAL hoy' }, config).accepted, true);
  assert.equal(evaluateFilters({ text: 'publicación normal' }, config).key, 'whitelist');
});

test('blocked words can require exact word boundaries', () => {
  const config = defaultFilterConfig();
  config.blockedWords = { enabled: true, words: ['promo'], match: 'exact' };
  assert.equal(evaluateFilters({ text: 'promociones de temporada' }, config).accepted, true);
  assert.equal(evaluateFilters({ text: 'Nueva PROMO hoy' }, config).key, 'blockedWords');
});

test('media type filters reject selected media only', () => {
  const config = defaultFilterConfig();
  config.media = { enabled: true, blockedTypes: ['photo'] };
  assert.equal(evaluateFilters({ photo: [{ file_id: 'x' }], caption: 'texto' }, config).key, 'media');
  assert.equal(evaluateFilters({ video: { file_id: 'v' }, caption: 'texto' }, config).accepted, true);
});

test('link filter detects hidden text URLs and inline button URLs', () => {
  const config = defaultFilterConfig();
  config.links = { enabled: true, text: false, buttons: true };
  const post = { text: 'sin enlace visible', reply_markup: { inline_keyboard: [[{ text: 'Abrir', url: 'https://example.com' }]] } };
  assert.equal(evaluateFilters(post, config).key, 'links');
});

test('character and line limits reject oversized messages', () => {
  const config = defaultFilterConfig();
  config.limits = { enabled: true, maxCharacters: 8, maxLines: 1 };
  assert.equal(evaluateFilters({ text: '123456789' }, config).key, 'limits');
});

test('time ranges support windows that cross midnight', () => {
  const config = defaultFilterConfig();
  config.time = { enabled: true, timezone: 'America/Mexico_City', ranges: [{ start: '22:00', end: '02:00' }] };
  assert.equal(evaluateFilters({ text: 'ok' }, config, { now: new Date('2026-11-13T06:30:00Z') }).accepted, true);
});

test('excluded weekdays are evaluated in the configured local timezone', () => {
  const config = defaultFilterConfig();
  config.days = { enabled: true, excluded: [5] };
  assert.equal(evaluateFilters({ text: 'ok' }, config, { now: new Date('2026-11-13T18:00:00Z') }).key, 'days');
});

test('regex filters validate the configured expression at runtime', () => {
  const config = defaultFilterConfig();
  config.regex = { enabled: true, pattern: '\\b(news|update)\\b', flags: 'i' };
  assert.equal(evaluateFilters({ text: 'Daily update' }, config).key, 'regex');
  assert.equal(evaluateFilters({ text: 'Daily digest' }, config).accepted, true);
});

test('blocked words take priority over whitelist failures', () => {
  const config = defaultFilterConfig();
  config.whitelist = { enabled: true, words: ['approved'] };
  config.blockedWords = { enabled: true, words: ['blocked'] };
  assert.equal(evaluateFilters({ text: 'blocked content' }, config).key, 'blockedWords');
});

test('a required signature accepts any non-empty signature when no allowlist is supplied', () => {
  const config = defaultFilterConfig();
  config.signatures = { enabled: true, requireSignature: true, allowed: [] };
  assert.equal(evaluateFilters({ text: 'post', author_signature: 'Admin' }, config).accepted, true);
  assert.equal(evaluateFilters({ text: 'post' }, config).key, 'signatures');
});

test('configuration merges route overrides over channel and global values', () => {
  const merged = mergeFilterConfigs(
    { whitelist: { enabled: true, words: ['global'] }, quota: { maxMessages: 5 } },
    { whitelist: { words: ['channel'] } },
    { whitelist: { mode: 'all' } },
  );
  assert.deepEqual(merged.whitelist.words, ['channel']);
  assert.equal(merged.whitelist.enabled, true);
  assert.equal(merged.whitelist.mode, 'all');
  assert.equal(merged.quota.maxMessages, 5);
});

test('local date keys use the selected timezone', () => {
  assert.equal(localDateKey(new Date('2026-11-13T05:30:00Z'), 'America/Mexico_City'), '2026-11-12');
});

test('case-sensitive exact matching preserves capitalization', () => {
  const config = defaultFilterConfig();
  config.blockedWords = { enabled: true, words: ['Promo'], match: 'exact', caseSensitive: true };
  assert.equal(evaluateFilters({ text: 'promo' }, config).accepted, true);
  assert.equal(evaluateFilters({ text: 'Promo' }, config).key, 'blockedWords');
});
