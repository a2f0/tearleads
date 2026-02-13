import { isJsonValue, isRecord, type JsonValue } from './json.js';

export const TEE_ECHO_PATH = '/v1/tee/echo';

export interface TeeEchoRequest {
  message: string;
  [key: string]: JsonValue;
}

export interface TeeEchoResponse {
  message: string;
  receivedAt: string;
  [key: string]: JsonValue;
}

export function isTeeEchoRequest(value: unknown): value is TeeEchoRequest {
  if (!isRecord(value)) {
    return false;
  }

  const message = value['message'];
  return typeof message === 'string' && message.length > 0;
}

export function parseTeeEchoRequest(value: unknown): TeeEchoRequest {
  if (!isTeeEchoRequest(value)) {
    throw new Error('Invalid tee echo request payload');
  }

  return {
    message: value.message
  };
}

export function isTeeEchoResponse(value: unknown): value is TeeEchoResponse {
  if (!isRecord(value)) {
    return false;
  }

  const message = value['message'];
  const receivedAt = value['receivedAt'];
  return typeof message === 'string' && typeof receivedAt === 'string';
}

export function parseTeeEchoResponse(value: JsonValue): TeeEchoResponse {
  if (!isJsonValue(value) || !isTeeEchoResponse(value)) {
    throw new Error('Invalid tee echo response payload');
  }

  return {
    message: value.message,
    receivedAt: value.receivedAt
  };
}
