import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HelpDocumentation } from './HelpDocumentation';

vi.mock('@tearleads/ui', async () => {
  const actual = await vi.importActual<typeof import('@tearleads/ui')>(
    '@tearleads/ui'
  );
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: 'light' })
  };
});

vi.mock('@/components/markdown-viewer/MarkdownWithToc', () => ({
  MarkdownWithToc: ({ source }: { source: string }) => (
    <div data-testid="markdown-content">{source.slice(0, 16)}</div>
  )
}));

vi.mock('@/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/i18n')>('@/i18n');
  return {
    ...actual,
    useTypedTranslation: () => ({
      i18n: { resolvedLanguage: 'en', language: 'en' }
    })
  };
});

describe('HelpDocumentation', () => {
  it('renders documentation title and content', () => {
    render(<HelpDocumentation docId="ci" />);
    expect(
      screen.getByRole('heading', { name: 'CI Documentation' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });
});
