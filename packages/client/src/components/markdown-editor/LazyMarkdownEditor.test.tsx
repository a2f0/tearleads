import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({
    value,
    colorMode
  }: {
    value: string;
    colorMode: string;
  }) => (
    <div data-testid="markdown-editor" data-color-mode={colorMode}>
      {value}
    </div>
  )
}));

import { LazyMarkdownEditor } from './LazyMarkdownEditor';

describe('LazyMarkdownEditor', () => {
  it('renders the editor after lazy loading', async () => {
    render(
      <LazyMarkdownEditor
        value="test content"
        onChange={vi.fn()}
        colorMode="light"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
    });

    expect(screen.getByText('test content')).toBeInTheDocument();
  });

  it('passes colorMode to the editor', async () => {
    render(
      <LazyMarkdownEditor value="test" onChange={vi.fn()} colorMode="dark" />
    );

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toHaveAttribute(
        'data-color-mode',
        'dark'
      );
    });
  });
});
