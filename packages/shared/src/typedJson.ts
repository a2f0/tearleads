import { base64ToBytes, bytesToBase64 } from './base64.js';
import { isRecord } from './typeGuards.js';

const UINT8_ARRAY_SENTINEL = '__tearleadsUint8Array';

interface Uint8ArrayJsonShape {
  __tearleadsUint8Array: string;
}

function isUint8ArrayJsonShape(value: unknown): value is Uint8ArrayJsonShape {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== UINT8_ARRAY_SENTINEL) {
    return false;
  }

  const data = value[UINT8_ARRAY_SENTINEL];
  return typeof data === 'string';
}

function replaceUint8Arrays(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      [UINT8_ARRAY_SENTINEL]: bytesToBase64(value)
    };
  }

  return value;
}

function reviveUint8Arrays(_key: string, value: unknown): unknown {
  if (!isUint8ArrayJsonShape(value)) {
    return value;
  }

  return base64ToBytes(value[UINT8_ARRAY_SENTINEL]) ?? value;
}

export function stringifyJsonWithByteArrays(value: unknown): string {
  return JSON.stringify(value, replaceUint8Arrays);
}

export function parseJsonWithByteArrays(value: string): unknown {
  return JSON.parse(value, reviveUint8Arrays);
}
