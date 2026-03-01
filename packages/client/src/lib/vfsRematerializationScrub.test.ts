import { describe, expect, it } from 'vitest';
import {
  resolveMaterializedNoteContent,
  resolveMaterializedNoteTitle
} from './vfsRematerializationScrub';

describe('vfsRematerializationScrub', () => {
  it('returns untitled note when title is missing or blank', () => {
    expect(resolveMaterializedNoteTitle(null)).toBe('Untitled Note');
    expect(resolveMaterializedNoteTitle('   ')).toBe('Untitled Note');
  });

  it('scrubs control characters from materialized titles', () => {
    expect(resolveMaterializedNoteTitle(' \u0000Shared\u0007 Note ')).toBe(
      'Shared Note'
    );
  });

  it('decodes base64 UTF-8 note content', () => {
    expect(resolveMaterializedNoteContent('SGVsbG8sIEFsaWNl')).toBe(
      'Hello, Alice'
    );
  });

  it('returns empty content for malformed or non-utf8 payloads', () => {
    expect(resolveMaterializedNoteContent('***')).toBe('');
    expect(resolveMaterializedNoteContent('//8=')).toBe('');
  });

  it('scrubs control characters from decoded content', () => {
    expect(resolveMaterializedNoteContent('SGVsbG8AV29ybGQ=')).toBe(
      'HelloWorld'
    );
  });

  it('returns empty content when atob is unavailable', () => {
    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, 'atob', {
      configurable: true,
      writable: true,
      value: undefined
    });
    expect(resolveMaterializedNoteContent('SGVsbG8=')).toBe('');
    Object.defineProperty(globalThis, 'atob', {
      configurable: true,
      writable: true,
      value: originalAtob
    });
  });

  it('truncates overly long materialized values', () => {
    const longTitle = ` ${'T'.repeat(300)} `;
    expect(resolveMaterializedNoteTitle(longTitle).length).toBe(256);

    const longContent = 'A'.repeat(100_001);
    const encoded = btoa(longContent);
    expect(resolveMaterializedNoteContent(encoded).length).toBe(100_000);
  });
});
