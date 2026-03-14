import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleDocumentation } from './ConsoleDocumentation';

const themeState = {
  resolvedTheme: 'light'
};

vi.mock('@tearleads/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tearleads/ui')>();
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: themeState.resolvedTheme })
  };
});

vi.mock('@client/components/markdown-viewer/MarkdownWithToc', () => ({
  MarkdownWithToc: ({
    source,
    markdownColorMode
  }: {
    source: string;
    markdownColorMode: string;
  }) => (
    <div data-color-mode={markdownColorMode} data-testid="markdown-content">
      {source.slice(0, 24)}
    </div>
  )
}));

describe('ConsoleDocumentation', () => {
  it('renders console docs heading and markdown', () => {
    themeState.resolvedTheme = 'light';
    render(<ConsoleDocumentation />);
    expect(
      screen.getByRole('heading', { name: 'Console Reference Documentation' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });

  it('uses dark markdown mode for non-light themes', () => {
    themeState.resolvedTheme = 'dark';
    render(<ConsoleDocumentation />);
    expect(screen.getByTestId('markdown-content')).toHaveAttribute(
      'data-color-mode',
      'dark'
    );
  });
});
