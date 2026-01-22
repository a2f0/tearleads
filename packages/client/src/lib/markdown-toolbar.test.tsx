import type { ICommand } from '@uiw/react-md-editor';
import { describe, expect, it, vi } from 'vitest';
import { markdownToolbarCommandsFilter } from './markdown-toolbar';

function assertCommand(value: false | ICommand): asserts value is ICommand {
  if (value === false) {
    throw new Error('Expected command');
  }
}

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

  it('returns commands without button props unchanged', () => {
    const command = { name: 'plain-command' };
    const result = markdownToolbarCommandsFilter(command, false);
    expect(result).toBe(command);
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

    assertCommand(result);
    if (result.render) {
      expect(result.buttonProps?.title).toBeUndefined();
      expect(result.render).toBeTypeOf('function');
    }
  });

  it('returns null from render when no tooltip label is available', () => {
    const command = {
      name: '',
      keyCommand: '',
      buttonProps: {
        title: 'No label'
      }
    };

    const result = markdownToolbarCommandsFilter(command, false);
    expect(result).not.toBe(false);

    assertCommand(result);
    if (result.render) {
      const rendered = result.render(result, false, vi.fn(), 0);
      expect(rendered).toBeNull();
    }
  });

  it('renders tooltip content when a label is available', () => {
    const command = {
      name: 'format',
      keyCommand: 'format',
      buttonProps: {
        'aria-label': 'Format text'
      }
    };

    const result = markdownToolbarCommandsFilter(command, false);
    expect(result).not.toBe(false);

    assertCommand(result);
    if (result.render) {
      const rendered = result.render(result, false, vi.fn(), 0);
      expect(rendered).not.toBeNull();
    }
  });
});
