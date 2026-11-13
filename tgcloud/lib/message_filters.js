const DEFAULT_FILTERS = Object.freeze({
  enabled: false,
  whitelist: { enabled: false, words: [], mode: 'any', caseSensitive: false, match: 'partial', searchText: true, searchCaption: true },
  blockedWords: { enabled: false, words: [], caseSensitive: false, match: 'partial', searchText: true, searchCaption: true },
  regex: { enabled: false, pattern: '', flags: 'i' },
  limits: { enabled: false, maxCharacters: 0, maxLines: 0 },
  time: { enabled: false, timezone: 'America/Mexico_City', ranges: [] },
  days: { enabled: false, excluded: [] },
  links: { enabled: false, text: false, buttons: false },
  media: { enabled: false, blockedTypes: [] },
  specific: { enabled: false, blockForwarded: false, blockedPatterns: [], blockRepeated: false, repeatMinutes: 60 },
  signatures: { enabled: false, allowed: [], requireSignature: false, caseSensitive: false, match: 'exact' },
  quota: { enabled: false, maxMessages: 0, windowMinutes: 25 },
  rejection: { default: 'discard', perFilter: {} },
});

export function defaultFilterConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_FILTERS));
}

export function mergeFilterConfigs(...configs) {
  const merged = defaultFilterConfig();
  for (const source of configs) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        merged[key] = { ...(merged[key] || {}), ...value };
      } else if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}

function normalize(value, caseSensitive) {
  const text = String(value ?? '').normalize('NFC');
  return caseSensitive ? text : text.toLocaleLowerCase('es-MX');
}

function wordMatches(haystack, needle, mode, caseSensitive) {
  const source = normalize(haystack, caseSensitive);
  const term = normalize(needle, caseSensitive).trim();
  if (!term) return false;
  if (mode !== 'exact') return source.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}_])' + escaped + '($|[^\\p{L}\\p{N}_])', 'u').test(source);
}

function getText(post, rule) {
  const chunks = [];
  if (rule.searchText !== false && post?.text) chunks.push(String(post.text));
  if (rule.searchCaption !== false && post?.caption) chunks.push(String(post.caption));
  return chunks.join('\\n');
}

function mediaTypes(post) {
  const types = [];
  if (post?.text) types.push('text');
  if (post?.photo) types.push('photo');
  if (post?.video) types.push('video');
  if (post?.animation) types.push('gif');
  if (post?.audio) types.push('audio');
  if (post?.voice) types.push('voice');
  if (post?.document) types.push('document');
  if (post?.video_note) types.push('video_note');
  if (post?.sticker) types.push('sticker');
  if (post?.media_group_id) types.push('album');
  return types;
}

function hasTextLinks(post) {
  const entities = [...(post?.entities || []), ...(post?.caption_entities || [])];
  if (entities.some(entity => entity?.type === 'url' || entity?.type === 'text_link')) return true;
  return /(?:https?:\\/\\/|www\\.|t\\.me\\/)[^\\s]+/i.test(String(post?.text ?? '') + '\\n' + String(post?.caption ?? ''));
}

function hasButtonLinks(post) {
  const rows = post?.reply_markup?.inline_keyboard || [];
  return rows.some(row => Array.isArray(row) && row.some(button => typeof button?.url === 'string' && button.url.trim()));
}

function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/Mexico_City',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { day: weekdays[map.weekday], minute: Number(map.hour) * 60 + Number(map.minute) };
}

function inTimeRange(minute, range) {
  const parse = value => {
    const match = /^(\\d{1,2}):(\\d{2})$/.exec(String(value ?? ''));
    if (!match) return NaN;
    const h = Number(match[1]); const m = Number(match[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : NaN;
  };
  const start = parse(range?.start); const end = parse(range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start <= end) return minute >= start && minute <= end;
  return minute >= start || minute <= end;
}

export function evaluateFilters(post, config, options = {}) {
  const cfg = mergeFilterConfigs(config);
  if (!cfg.enabled) return { accepted: true };
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const text = String(post?.text ?? post?.caption ?? '');
  const checks = [
    () => {
      const rule = cfg.whitelist || {};
      if (!rule.enabled) return null;
      const words = (Array.isArray(rule.words) ? rule.words : []).map(String).filter(word => word.trim());
      if (!words.length) return { key: 'whitelist', reason: 'La lista blanca está activada pero no contiene palabras permitidas.' };
      const haystack = getText(post, rule);
      const matches = words.map(word => wordMatches(haystack, word, rule.match, rule.caseSensitive));
      const valid = rule.mode === 'all' ? matches.every(Boolean) : matches.some(Boolean);
      return valid ? null : { key: 'whitelist', reason: 'El mensaje no contiene las palabras o frases requeridas por la lista blanca.' };
    },
    () => {
      const rule = cfg.blockedWords || {};
      if (!rule.enabled) return null;
      const haystack = getText(post, rule);
      const found = (Array.isArray(rule.words) ? rule.words : []).find(word => wordMatches(haystack, word, rule.match, rule.caseSensitive));
      return found ? { key: 'blockedWords', reason: 'Se detectó una palabra o frase bloqueada: ' + String(found).slice(0, 80) } : null;
    },
    () => {
      const rule = cfg.regex || {};
      if (!rule.enabled || !rule.pattern) return null;
      try {
        const regex = new RegExp(rule.pattern, String(rule.flags ?? 'i').replace(/[^dgimsuvy]/g, ''));
        return regex.test(text) ? null : { key: 'regex', reason: 'El contenido no cumple el filtro Regex configurado.' };
      } catch {
        return { key: 'regex', reason: 'El filtro Regex tiene una expresión no válida.' };
      }
    },
    () => {
      const rule = cfg.limits || {};
      if (!rule.enabled) return null;
      const maxCharacters = Number(rule.maxCharacters) || 0;
      const maxLines = Number(rule.maxLines) || 0;
      if (maxCharacters > 0 && [...text].length > maxCharacters) return { key: 'limits', reason: 'El mensaje supera el máximo de ' + maxCharacters + ' caracteres.' };
      const lines = text ? text.split(/\\r?\\n/).length : 0;
      if (maxLines > 0 && lines > maxLines) return { key: 'limits', reason: 'El mensaje supera el máximo de ' + maxLines + ' líneas.' };
      return null;
    },
    () => {
      const rule = cfg.time || {};
      if (!rule.enabled || !Array.isArray(rule.ranges) || !rule.ranges.length) return null;
      let clock;
      try { clock = localClock(now, rule.timezone); } catch { return { key: 'time', reason: 'La zona horaria configurada no es válida.' }; }
      return rule.ranges.some(range => inTimeRange(clock.minute, range))
        ? null : { key: 'time', reason: 'La publicación está fuera de las franjas horarias permitidas.' };
    },
    () => {
      const rule = cfg.days || {};
      if (!rule.enabled) return null;
      let clock;
      try { clock = localClock(now, cfg.time?.timezone); } catch { return null; }
      const excluded = (Array.isArray(rule.excluded) ? rule.excluded : []).map(Number);
      return excluded.includes(clock.day) ? { key: 'days', reason: 'Este día está excluido de la distribución.' } : null;
    },
    () => {
      const rule = cfg.links || {};
      if (!rule.enabled) return null;
      if (rule.text && hasTextLinks(post)) return { key: 'links', reason: 'El mensaje contiene un enlace en el texto o descripción.' };
      if (rule.buttons && hasButtonLinks(post)) return { key: 'links', reason: 'La publicación contiene botones con enlaces.' };
      return null;
    },
    () => {
      const rule = cfg.media || {};
      if (!rule.enabled) return null;
      const blocked = new Set(Array.isArray(rule.blockedTypes) ? rule.blockedTypes : []);
      const found = mediaTypes(post).find(type => blocked.has(type));
      return found ? { key: 'media', reason: 'El tipo de contenido está bloqueado: ' + found } : null;
    },
    () => {
      const rule = cfg.specific || {};
      if (!rule.enabled) return null;
      const forwarded = Boolean(post?.forward_origin || post?.forward_from || post?.forward_from_chat || post?.forward_sender_name);
      if (rule.blockForwarded && forwarded) return { key: 'specific', reason: 'Las publicaciones reenviadas están bloqueadas.' };
      const found = (Array.isArray(rule.blockedPatterns) ? rule.blockedPatterns : []).find(pattern => wordMatches(text, pattern, 'partial', false));
      return found ? { key: 'specific', reason: 'Se detectó un patrón de contenido excluido.' } : null;
    },
    () => {
      const rule = cfg.signatures || {};
      if (!rule.enabled) return null;
      const signature = String(post?.author_signature ?? '').trim();
      const allowed = (Array.isArray(rule.allowed) ? rule.allowed : []).map(String).filter(Boolean);
      if (!allowed.length && !rule.requireSignature) return null;
      if (!signature) return { key: 'signatures', reason: 'La publicación no incluye una firma de administrador autorizada.' };
      const found = allowed.some(value => rule.match === 'partial'
        ? normalize(signature, rule.caseSensitive).includes(normalize(value, rule.caseSensitive))
        : normalize(signature, rule.caseSensitive) === normalize(value, rule.caseSensitive));
      return found ? null : { key: 'signatures', reason: 'La firma del administrador no está en la lista autorizada.' };
    },
  ];
  for (const check of checks) {
    const rejection = check();
    if (rejection) return { accepted: false, ...rejection, behavior: cfg.rejection?.perFilter?.[rejection.key] || cfg.rejection?.default || 'discard' };
  }
  return { accepted: true };
}

export function filterFingerprint(post) {
  const payload = [
    String(post?.text ?? post?.caption ?? '').normalize('NFC').trim().toLocaleLowerCase('es-MX'),
    mediaTypes(post).join(','),
    String(post?.photo?.at?.(-1)?.file_unique_id ?? post?.video?.file_unique_id ?? post?.document?.file_unique_id ?? ''),
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function isRepeatedContent(post, config, seenAt, now = Date.now()) {
  const rule = config?.specific || {};
  if (!rule.enabled || !rule.blockRepeated || !seenAt) return false;
  const minutes = Math.max(1, Math.min(10080, Number(rule.repeatMinutes) || 60));
  return Number(now) - Number(seenAt) <= minutes * 60 * 1000;
}
