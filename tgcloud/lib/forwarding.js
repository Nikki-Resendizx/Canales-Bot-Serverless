export function defaultForwardConfig() {
  return {
    notifyOwner: false,
    pinPost: false,
    initialDelaySeconds: 0,
    intervalSeconds: 0,
    albumMode: 'preserve',
  };
}

export function normalizeForwardConfig(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const boundedSeconds = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(30, Math.floor(parsed))) : 0;
  };
  return {
    notifyOwner: source.notifyOwner === true,
    pinPost: source.pinPost === true,
    initialDelaySeconds: boundedSeconds(source.initialDelaySeconds),
    intervalSeconds: boundedSeconds(source.intervalSeconds),
    albumMode: source.albumMode === 'split' ? 'split' : 'preserve',
  };
}

export function parseForwardDelays(input) {
  const values = String(input ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(Number);
  if (values.length !== 2 || values.some(value => !Number.isInteger(value) || value < 0 || value > 30)) {
    return { valid: false, reason: 'Envía dos números enteros entre 0 y 30.' };
  }
  return { valid: true, initialDelaySeconds: values[0], intervalSeconds: values[1] };
}


const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function normalizeTextLineBreaks(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\/n(?=$|\s)/g, '\n');
}

function retryAfterSeconds(error) {
  const candidates = [error?.parameters?.retry_after, error?.response?.parameters?.retry_after, error?.error?.parameters?.retry_after, error?.retry_after];
  for (const value of candidates) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  }
  const match = String(error?.message ?? error ?? '').match(/retry after\s+(\d+)/i);
  return match ? Math.max(1, Number(match[1])) : 0;
}

export async function sendWithFloodProtection(send, options = {}) {
  const minIntervalMs = Math.max(0, Math.min(30000, Number(options.minIntervalMs) || 0));
  const maxRetries = Math.max(0, Math.min(2, Math.floor(Number(options.maxRetries) || 0)));
  let lastSentAt = Number(options.lastSentAt) || 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const waitMs = Math.max(0, lastSentAt + minIntervalMs - Date.now());
    if (waitMs) await sleep(waitMs);
    try {
      const result = await send();
      return { result, lastSentAt: Date.now() };
    } catch (error) {
      const retryAfter = retryAfterSeconds(error);
      if (!retryAfter || attempt >= maxRetries) throw error;
      await sleep(Math.min(60, retryAfter) * 1000);
    }
  }
  throw new Error('Se agotaron los reintentos de entrega.');
}
