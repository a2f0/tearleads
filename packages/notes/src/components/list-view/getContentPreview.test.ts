import { describe, expect, it } from 'vitest';
import { getContentPreview } from './getContentPreview';

describe('getContentPreview', () => {
  it('strips markdown markers and falls back to default text', () => {
    expect(getContentPreview('## Title\n**bold** _italic_')).toBe('Title\nbold italic');
    expect(getContentPreview('   ')).toBe('No content');
  });

  it('truncates long content to 100 chars plus ellipsis', () => {
    const long = 'a'.repeat(120);
    expect(getContentPreview(long)).toBe(`${'a'.repeat(100)}...`);
  });
});
