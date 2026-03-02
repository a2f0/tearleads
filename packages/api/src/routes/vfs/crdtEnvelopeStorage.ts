import { parseBooleanEnv } from './parseBooleanEnv.js';

const ENVELOPE_BYTEA_WRITES_FLAG = 'VFS_CRDT_ENVELOPE_BYTEA_WRITES';
const ENVELOPE_DUAL_TEXT_WRITES_FLAG = 'VFS_CRDT_ENVELOPE_DUAL_WRITE_TEXT';

function shouldWriteEnvelopeBytea(): boolean {
  return parseBooleanEnv(process.env[ENVELOPE_BYTEA_WRITES_FLAG], true);
}

function shouldDualWriteEnvelopeText(): boolean {
  return parseBooleanEnv(process.env[ENVELOPE_DUAL_TEXT_WRITES_FLAG], false);
}

function trimBase64Padding(value: string): string {
  return value.replace(/=+$/u, '');
}

function decodeBase64ToBuffer(value: string): Buffer | null {
  const normalized = value
    .replace(/\s+/gu, '')
    .replace(/-/gu, '+')
    .replace(/_/gu, '/');

  if (normalized.length === 0 || /[^A-Za-z0-9+/=]/u.test(normalized)) {
    return null;
  }

  const remainder = normalized.length % 4;
  if (remainder === 1) {
    return null;
  }

  const padded =
    remainder === 0
      ? normalized
      : normalized.padEnd(normalized.length + (4 - remainder), '=');

  const decoded = Buffer.from(padded, 'base64');
  if (
    trimBase64Padding(decoded.toString('base64')) !==
    trimBase64Padding(normalized)
  ) {
    return null;
  }

  return decoded;
}

export interface SerializedEnvelopeField {
  text: string | null;
  bytes: Buffer | null;
}

export function serializeEnvelopeField(
  value: string | null | undefined
): SerializedEnvelopeField {
  if (typeof value !== 'string') {
    return {
      text: null,
      bytes: null
    };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {
      text: null,
      bytes: null
    };
  }

  if (!shouldWriteEnvelopeBytea()) {
    return {
      text: trimmed,
      bytes: null
    };
  }

  const decoded = decodeBase64ToBuffer(trimmed);
  if (!decoded) {
    return {
      text: trimmed,
      bytes: null
    };
  }

  return {
    text: shouldDualWriteEnvelopeText() ? trimmed : null,
    bytes: decoded
  };
}
