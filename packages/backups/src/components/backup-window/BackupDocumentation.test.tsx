import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BackupDocumentation } from './BackupDocumentation';

vi.mock('@tearleads/ui', () => ({
  useTheme: () => ({ resolvedTheme: 'light' })
}));

vi.mock('@uiw/react-md-editor', () => ({
  __esModule: true,
  default: {
    Markdown: ({ source }: { source: string }) => (
      <div data-testid="markdown">{source.slice(0, 20)}</div>
    )
  }
}));

describe('BackupDocumentation', () => {
  it('renders docs heading and markdown', () => {
    render(<BackupDocumentation />);

    expect(
      screen.getByText('Backup & Restore Documentation')
    ).toBeInTheDocument();
    expect(screen.getByTestId('markdown-toc-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-content-scroll')).toBeInTheDocument();
    expect(screen.getAllByTestId('markdown').length).toBeGreaterThan(0);
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<BackupDocumentation onBack={onBack} />);

    await user.click(
      screen.getByRole('button', { name: 'Back to Backup Manager' })
    );

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
