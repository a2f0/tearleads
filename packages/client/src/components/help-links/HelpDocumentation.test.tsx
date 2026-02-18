import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HelpDocumentation } from './HelpDocumentation';

let mockResolvedTheme: 'light' | 'dark' = 'light';
let mockResolvedLanguage = 'en';
let mockLanguage = 'en';

vi.mock('@tearleads/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/ui')>('@tearleads/ui');
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: mockResolvedTheme })
  };
});

vi.mock('@/components/markdown-viewer/MarkdownWithToc', () => ({
  MarkdownWithToc: ({
    source,
    markdownColorMode
  }: {
    source: string;
    markdownColorMode: string;
  }) => (
    <div data-testid="markdown-content" data-color-mode={markdownColorMode}>
      {source.slice(0, 16)}
    </div>
  )
}));

vi.mock('@/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/i18n')>('@/i18n');
  return {
    ...actual,
    useTypedTranslation: () => ({
      i18n: { resolvedLanguage: mockResolvedLanguage, language: mockLanguage }
    })
  };
});

describe('HelpDocumentation', () => {
  it('renders documentation title and content', () => {
    mockResolvedTheme = 'light';
    mockResolvedLanguage = 'en';
    mockLanguage = 'en';

    render(<HelpDocumentation docId="ci" />);
    expect(
      screen.getByRole('heading', { name: 'CI Documentation' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });

  it('uses dark markdown mode when theme is dark', () => {
    mockResolvedTheme = 'dark';
    mockResolvedLanguage = 'en';
    mockLanguage = 'en';

    render(<HelpDocumentation docId="ci" />);

    expect(screen.getByTestId('markdown-content')).toHaveAttribute(
      'data-color-mode',
      'dark'
    );
  });

  it('falls back to english for unsupported resolved language', () => {
    mockResolvedTheme = 'light';
    mockResolvedLanguage = 'fr';
    mockLanguage = 'fr';

    render(<HelpDocumentation docId="ci" />);

    expect(screen.getByTestId('markdown-content').textContent).not.toBe('');
  });

  it('falls back to english when selected language has no doc variant', () => {
    mockResolvedTheme = 'light';
    mockResolvedLanguage = 'es';
    mockLanguage = 'es';

    render(<HelpDocumentation docId="consoleReference" />);

    expect(
      screen.getByRole('heading', {
        name: 'Console Reference Documentation'
      })
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content').textContent).not.toBe('');
  });
});
