import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HelpDocumentation } from './HelpDocumentation';

vi.mock('@tearleads/ui', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}));

vi.mock('@tearleads/backups', () => ({
  MarkdownWithToc: ({ source }: { source: string }) => (
    <div data-testid="markdown-content">{source.slice(0, 24)}</div>
  )
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'en', language: 'en' }
  })
}));

describe('HelpDocumentation', () => {
  it('renders CI documentation content', () => {
    render(<HelpDocumentation docId="ci" />);

    expect(
      screen.getByRole('heading', { name: 'CI Documentation' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'How CI impact analysis and status-check gating works in pull requests.'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });
});
