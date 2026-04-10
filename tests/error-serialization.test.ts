import { describe, expect, test } from 'vitest';

import { serializeErrorForOutput } from '../shared/error-serialization.ts';

describe('serializeErrorForOutput', () => {
  test('serializes plain object errors instead of returning object toString output', () => {
    const serialized = serializeErrorForOutput({
      message: 'fetch failed',
      code: 'ECONNREFUSED',
      address: '127.0.0.1',
      port: 8080,
    });

    expect(serialized).not.toBe('[object Object]');
    expect(serialized).toContain('"message": "fetch failed"');
    expect(serialized).toContain('"code": "ECONNREFUSED"');
  });

  test('preserves nested cause details for Error instances', () => {
    const error = new Error('top level failure') as Error & {
      cause?: unknown;
      code?: string;
    };
    error.code = 'EPIPE';
    error.cause = {
      message: 'connect ECONNRESET',
      code: 'ECONNRESET',
    };

    const serialized = serializeErrorForOutput(error);

    expect(serialized).toContain('"message": "top level failure"');
    expect(serialized).toContain('"code": "EPIPE"');
    expect(serialized).toContain('"code": "ECONNRESET"');
  });

  test('handles circular structures safely', () => {
    const error: Record<string, unknown> = { message: 'circular failure' };
    error.self = error;

    const serialized = serializeErrorForOutput(error);

    expect(serialized).toContain('"message": "circular failure"');
    expect(serialized).toContain('"self": "[Circular]"');
  });

  test('keeps plain string errors readable', () => {
    expect(serializeErrorForOutput('network unavailable')).toBe(
      'network unavailable',
    );
  });
});
