import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HelpLinksGrid } from './HelpLinksGrid';

describe('HelpLinksGrid', () => {
  it('renders top-level actions', async () => {
    const user = userEvent.setup();
    const onApiDocsClick = vi.fn();
    const onDeveloperClick = vi.fn();
    const onLegalClick = vi.fn();

    render(
      <HelpLinksGrid
        view="topLevel"
        onApiDocsClick={onApiDocsClick}
        onDeveloperClick={onDeveloperClick}
        onLegalClick={onLegalClick}
        onDocClick={vi.fn()}
      />
    );

    await user.click(screen.getByText('API Docs'));
    await user.click(screen.getByText('Developer'));
    await user.click(screen.getByText('Legal'));

    expect(onApiDocsClick).toHaveBeenCalled();
    expect(onDeveloperClick).toHaveBeenCalled();
    expect(onLegalClick).toHaveBeenCalled();
  });

  it('invokes doc callbacks for developer and legal views', async () => {
    const user = userEvent.setup();
    const onDocClick = vi.fn();
    const commonProps = {
      onApiDocsClick: vi.fn(),
      onDeveloperClick: vi.fn(),
      onLegalClick: vi.fn(),
      onDocClick
    };

    const { rerender } = render(
      <HelpLinksGrid view="developer" {...commonProps} />
    );
    await user.click(screen.getByText('CLI Reference'));
    expect(onDocClick).toHaveBeenLastCalledWith('cliReference');

    rerender(<HelpLinksGrid view="legal" {...commonProps} />);
    await user.click(screen.getByText('Privacy Policy'));
    expect(onDocClick).toHaveBeenLastCalledWith('privacyPolicy');
  });
});
