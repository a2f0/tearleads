import { isRecord } from './typeGuards.js';

const UINT8_ARRAY_SENTINEL = '__tearleadsUint8Array';

interface Uint8ArrayJsonShape {
  __tearleadsUint8Array: number[];
}

function isByteValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
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
  return Array.isArray(data) && data.every(isByteValue);
}

function replaceUint8Arrays(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      [UINT8_ARRAY_SENTINEL]: Array.from(value)
    };
  }

  return value;
}

function reviveUint8Arrays(_key: string, value: unknown): unknown {
  if (!isUint8ArrayJsonShape(value)) {
    return value;
  }

  return Uint8Array.from(value[UINT8_ARRAY_SENTINEL]);
}

export function stringifyJsonWithByteArrays(value: unknown): string {
  return JSON.stringify(value, replaceUint8Arrays);
}

export function parseJsonWithByteArrays(value: string): unknown {
  return JSON.parse(value, reviveUint8Arrays);
}
