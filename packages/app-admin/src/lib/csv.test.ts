import { describe, expect, it } from 'vitest';
import { createCsv } from './csv';

describe('createCsv', () => {
  it('returns an empty string when there are no headers', () => {
    expect(createCsv([], [['value']])).toBe('');
  });

  it('serializes scalar, date, and structured values with csv escaping', () => {
    const createdAt = new Date('2026-03-09T12:00:00.000Z');

    expect(
      createCsv(
        ['name', 'active', 'count', 'createdAt', 'meta'],
        [
          [' spaced value ', true, 42n, createdAt, { tags: ['alpha', 'beta'] }],
          ['line\nbreak', false, 0, createdAt, 'a "quoted", value']
        ]
      )
    ).toBe(
      [
        'name,active,count,createdAt,meta',
        '" spaced value ",true,42,2026-03-09T12:00:00.000Z,"{""tags"":[""alpha"",""beta""]}"',
        '"line\nbreak",false,0,2026-03-09T12:00:00.000Z,"a ""quoted"", value"'
      ].join('\r\n')
    );
  });

  it('falls back to String(value) when JSON serialization throws', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(createCsv(['value'], [[circular]])).toBe('value\r\n[object Object]');
  });
});
