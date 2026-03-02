import { Code } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import {
  errorMessageFromPayload,
  toConnectCode
} from './httpStatusToConnectCode.js';

describe('httpStatusToConnectCode', () => {
  it('maps known HTTP status codes to connect codes', () => {
    expect(toConnectCode(400)).toBe(Code.InvalidArgument);
    expect(toConnectCode(401)).toBe(Code.Unauthenticated);
    expect(toConnectCode(403)).toBe(Code.PermissionDenied);
    expect(toConnectCode(404)).toBe(Code.NotFound);
    expect(toConnectCode(409)).toBe(Code.AlreadyExists);
    expect(toConnectCode(412)).toBe(Code.FailedPrecondition);
    expect(toConnectCode(429)).toBe(Code.ResourceExhausted);
    expect(toConnectCode(501)).toBe(Code.Unimplemented);
    expect(toConnectCode(503)).toBe(Code.Unavailable);
    expect(toConnectCode(504)).toBe(Code.DeadlineExceeded);
    expect(toConnectCode(500)).toBe(Code.Internal);
    expect(toConnectCode(599)).toBe(Code.Internal);
    expect(toConnectCode(418)).toBe(Code.Unknown);
  });

  it('uses error payload messages when present', () => {
    expect(errorMessageFromPayload({ error: 'bad input' }, 'fallback')).toBe(
      'bad input'
    );
  });

  it('falls back when payload error is absent or invalid', () => {
    expect(errorMessageFromPayload({ error: '' }, 'fallback')).toBe('fallback');
    expect(errorMessageFromPayload({ error: '   ' }, 'fallback')).toBe(
      'fallback'
    );
    expect(errorMessageFromPayload({ error: 42 }, 'fallback')).toBe('fallback');
    expect(errorMessageFromPayload(null, 'fallback')).toBe('fallback');
    expect(errorMessageFromPayload('oops', 'fallback')).toBe('fallback');
    expect(errorMessageFromPayload(['oops'], 'fallback')).toBe('fallback');
  });
});
