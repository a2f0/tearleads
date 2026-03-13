import { describe, expect, it } from 'vitest';
import {
  parseJsonWithByteArrays,
  stringifyJsonWithByteArrays
} from './typedJson.js';

describe('typedJson', () => {
  it('serializes Uint8Array payloads to compact base64 sentinel values', () => {
    expect(
      stringifyJsonWithByteArrays({
        payload: Uint8Array.from([1, 2, 3])
      })
    ).toBe('{"payload":{"__tearleadsUint8Array":"AQID"}}');
  });

  it('revives base64 sentinel values back into Uint8Array instances', () => {
    expect(
      parseJsonWithByteArrays('{"payload":{"__tearleadsUint8Array":"AQID"}}')
    ).toEqual({
      payload: Uint8Array.from([1, 2, 3])
    });
  });

  it('leaves invalid sentinel values unchanged', () => {
    expect(
      parseJsonWithByteArrays('{"payload":{"__tearleadsUint8Array":"%%%"}}')
    ).toEqual({
      payload: {
        __tearleadsUint8Array: '%%%'
      }
    });
  });

  it('round-trips empty byte arrays', () => {
    expect(
      parseJsonWithByteArrays(
        stringifyJsonWithByteArrays({
          payload: Uint8Array.from([])
        })
      )
    ).toEqual({
      payload: Uint8Array.from([])
    });
  });
});
