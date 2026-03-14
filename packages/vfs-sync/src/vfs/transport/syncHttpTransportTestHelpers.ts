import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';

export const PUSH_CRDT_OPS_PATH = `${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`;
export const GET_CRDT_SYNC_PATH = `${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`;
export const RECONCILE_CRDT_PATH = `${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`;
export const RUN_CRDT_SESSION_PATH = `${VFS_V2_CONNECT_BASE_PATH}/RunCrdtSession`;

export function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

export function asRecord(
  value: unknown,
  fieldName: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected ${fieldName} to be an object`);
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

export function encodeUtf8ToBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export const CURSOR_CHANGE_ID_1 = '00000000-0000-0000-0000-000000000001';
export const CURSOR_CHANGE_ID_2 = '00000000-0000-0000-0000-000000000002';
export const CURSOR_CHANGE_ID_4 = '00000000-0000-0000-0000-000000000004';
export const CURSOR_CHANGE_ID_5 = '00000000-0000-0000-0000-000000000005';
export const CURSOR_CHANGE_ID_6 = '00000000-0000-0000-0000-000000000006';
export const CURSOR_CHANGE_ID_7 = '00000000-0000-0000-0000-000000000007';
export const REQUESTED_CURSOR_CHANGE_ID =
  '00000000-0000-0000-0000-000000000010';
export const OLDEST_CURSOR_CHANGE_ID = '00000000-0000-0000-0000-000000000100';
