type SerializableRecord = Record<string, unknown>;

const SIMPLE_ERROR_KEYS = new Set(['name', 'message']);
const PRIORITY_ERROR_KEYS = [
  'name',
  'message',
  'code',
  'errno',
  'syscall',
  'address',
  'port',
  'status',
  'statusCode',
  'type',
  'cause',
];

function isRecord(value: unknown): value is SerializableRecord {
  return typeof value === 'object' && value !== null;
}

function normalizeErrorValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  if (depth >= 6) return '[MaxDepth]';

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeErrorValue(item, seen, depth + 1));
    }

    const result: SerializableRecord = {};
    const keys = new Set<string>();

    if (value instanceof Error) {
      for (const key of PRIORITY_ERROR_KEYS) {
        if (key in value) keys.add(key);
      }
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key !== 'stack') keys.add(key);
      }
    } else {
      for (const key of Object.keys(value)) {
        keys.add(key);
      }
    }

    for (const key of PRIORITY_ERROR_KEYS) {
      if (!keys.has(key)) continue;
      result[key] = normalizeErrorValue(
        (value as SerializableRecord)[key],
        seen,
        depth + 1,
      );
      keys.delete(key);
    }

    for (const key of keys) {
      result[key] = normalizeErrorValue(
        (value as SerializableRecord)[key],
        seen,
        depth + 1,
      );
    }

    return result;
  } finally {
    seen.delete(value);
  }
}

function formatSimpleErrorRecord(record: SerializableRecord): string | null {
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  if (keys.length === 0) return null;
  if (!keys.every((key) => SIMPLE_ERROR_KEYS.has(key))) return null;

  const message =
    typeof record.message === 'string' ? record.message.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';

  if (!message) return name || null;
  if (!name || name === 'Error') return message;
  return `${name}: ${message}`;
}

export function serializeErrorForOutput(error: unknown): string {
  if (typeof error === 'string') {
    return error.trim() || 'Unknown error';
  }

  const normalized = normalizeErrorValue(error, new WeakSet<object>(), 0);

  if (typeof normalized === 'string') {
    return normalized.trim() || 'Unknown error';
  }

  if (isRecord(normalized)) {
    const simple = formatSimpleErrorRecord(normalized);
    if (simple) return simple;
    return JSON.stringify(normalized, null, 2) || 'Unknown error';
  }

  return String(normalized ?? 'Unknown error');
}
