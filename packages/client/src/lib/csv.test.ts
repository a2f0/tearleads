import { describe, expect, it } from 'vitest';
import { createCsv } from './csv';

describe('createCsv', () => {
  it('returns empty string when no headers', () => {
    expect(createCsv([], [])).toBe('');
  });

  it('creates csv with headers and rows', () => {
    const csv = createCsv(['Name', 'Age'], [
      ['Alice', 30],
      ['Bob', 42]
    ]);
    expect(csv).toBe('Name,Age\r\nAlice,30\r\nBob,42');
  });

  it('escapes commas, quotes, and newlines', () => {
    const csv = createCsv(['Name', 'Note'], [
      ['Ada, Jr.', 'He said "hello"\nNew line']
    ]);
    expect(csv).toBe('Name,Note\r\n"Ada, Jr.","He said ""hello""\nNew line"');
  });

  it('quotes values with leading or trailing whitespace', () => {
    const csv = createCsv(['Value'], [['  padded '], ['trimmed']]);
    expect(csv).toBe('Value\r\n"  padded "\r\ntrimmed');
  });

  it('serializes null, undefined, and objects', () => {
    const csv = createCsv(['A', 'B', 'C', 'D'], [
      [null, undefined, { ok: true }, [1, 2]]
    ]);
    expect(csv).toBe('A,B,C,D\r\n,,"{""ok"":true}","[1,2]"');
  });
});
