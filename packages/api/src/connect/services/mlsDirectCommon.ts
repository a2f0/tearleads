import { Code, ConnectError } from '@connectrpc/connect';

export type MlsGroupRole = 'admin' | 'member';

export function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function toMlsGroupRole(value: unknown): MlsGroupRole {
  if (value === 'admin') {
    return 'admin';
  }

  if (value === 'member') {
    return 'member';
  }

  throw new ConnectError('Invalid group role', Code.Internal);
}
