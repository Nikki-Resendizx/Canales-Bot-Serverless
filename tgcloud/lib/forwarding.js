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
