import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleDocumentation } from './ConsoleDocumentation';

vi.mock('@tearleads/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/ui')>('@tearleads/ui');
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: 'light' })
  };
});

vi.mock('@tearleads/backups', () => ({
  MarkdownWithToc: ({ source }: { source: string }) => (
    <div data-testid="markdown-content">{source.slice(0, 24)}</div>
  )
}));

describe('ConsoleDocumentation', () => {
  it('renders console docs heading and markdown', () => {
    render(<ConsoleDocumentation />);
    expect(
      screen.getByRole('heading', { name: 'Console Reference Documentation' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
  });
});
