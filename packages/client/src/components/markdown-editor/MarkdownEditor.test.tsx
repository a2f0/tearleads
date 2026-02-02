import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@uiw/react-md-editor', () => ({
  default: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (value: string | undefined) => void;
  }) => (
    <textarea
      data-testid="md-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  commands: {
    codeEdit: { name: 'codeEdit' },
    codePreview: { name: 'codePreview' },
    divider: { name: 'divider' },
    fullscreen: { name: 'fullscreen' }
  }
}));

vi.mock('@rapid/notes', () => ({
  createMarkdownToolbarFilter: vi.fn(() => vi.fn())
}));

import { MarkdownEditor } from './MarkdownEditor';

describe('MarkdownEditor', () => {
  it('renders with light color mode', () => {
    render(
      <MarkdownEditor
        value="test content"
        onChange={vi.fn()}
        colorMode="light"
      />
    );

    const wrapper = screen.getByTestId('md-editor').parentElement;
    expect(wrapper).toHaveAttribute('data-color-mode', 'light');
  });

  it('renders with dark color mode', () => {
    render(
      <MarkdownEditor
        value="test content"
        onChange={vi.fn()}
        colorMode="dark"
      />
    );

    const wrapper = screen.getByTestId('md-editor').parentElement;
    expect(wrapper).toHaveAttribute('data-color-mode', 'dark');
  });

  it('calls onChange when content changes', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(
      <MarkdownEditor value="" onChange={handleChange} colorMode="light" />
    );

    await user.type(screen.getByTestId('md-editor'), 'new text');

    expect(handleChange).toHaveBeenCalled();
  });

  it('displays the provided value', () => {
    render(
      <MarkdownEditor
        value="initial content"
        onChange={vi.fn()}
        colorMode="light"
      />
    );

    expect(screen.getByTestId('md-editor')).toHaveValue('initial content');
  });
});
