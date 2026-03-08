import { describe, expect, it } from 'vitest';
import {
  createConnectJsonPostInit,
  isPlainRecord,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString
} from './connectJson.js';

describe('connectJson helpers', () => {
  it('builds JSON post request init', () => {
    expect(createConnectJsonPostInit({ alpha: 1 })).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"alpha":1}'
    });
  });

  it('parses connect json strings', () => {
    expect(parseConnectJsonString('{"ok":true}')).toEqual({ ok: true });
    expect(parseConnectJsonString('')).toEqual({});
    expect(parseConnectJsonString(undefined)).toEqual({});
  });

  it('parses connect json envelope payloads', () => {
    expect(parseConnectJsonEnvelopeBody({ json: '{"ok":true}' })).toEqual({
      ok: true
    });
    expect(parseConnectJsonEnvelopeBody({ json: '  ' })).toEqual({});
    expect(parseConnectJsonEnvelopeBody({ json: { ok: true } })).toEqual({
      ok: true
    });
    expect(parseConnectJsonEnvelopeBody({ json: undefined })).toEqual({});
    expect(parseConnectJsonEnvelopeBody({ ok: true })).toEqual({ ok: true });
  });

  it('throws for invalid connect json envelopes', () => {
    expect(() => parseConnectJsonEnvelopeBody({ json: '{invalid' })).toThrow(
      'transport returned invalid connect json envelope'
    );
  });

  it('detects plain records only', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord('x')).toBe(false);
  });
});
