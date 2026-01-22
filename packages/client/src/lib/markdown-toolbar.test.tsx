import { describe, expect, it } from 'vitest';
import { markdownToolbarCommandsFilter } from './markdown-toolbar';

describe('markdownToolbarCommandsFilter', () => {
  it('filters out the help command', () => {
    const result = markdownToolbarCommandsFilter({ keyCommand: 'help' }, false);
    expect(result).toBe(false);
  });

  it('returns divider commands unchanged', () => {
    const divider = { keyCommand: 'divider' };
    const result = markdownToolbarCommandsFilter(divider, false);
    expect(result).toBe(divider);
  });

  it('strips title attributes and assigns render for button commands', () => {
    const command = {
      name: 'bold',
      keyCommand: 'bold',
      buttonProps: {
        title: 'Add bold text',
        'aria-label': 'Add bold text'
      }
    };

    const result = markdownToolbarCommandsFilter(command, false);
    expect(result).not.toBe(false);

    if (result && result !== false) {
      expect(result.buttonProps?.title).toBeUndefined();
      expect(result.render).toBeTypeOf('function');
    }
  });
});
