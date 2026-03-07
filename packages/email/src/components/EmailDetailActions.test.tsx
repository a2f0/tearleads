import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TestEmailProvider } from '../test/testUtils';
import { EmailDetailActions } from './EmailDetailActions';

describe('EmailDetailActions', () => {
  const onComposeForMode = vi.fn();

  const renderWithProvider = () => {
    return render(
      <TestEmailProvider>
        <EmailDetailActions onComposeForMode={onComposeForMode} />
      </TestEmailProvider>
    );
  };

  it('renders Reply, Reply All, and Forward buttons', () => {
    renderWithProvider();
    expect(screen.getByTestId('email-action-reply')).toBeInTheDocument();
    expect(screen.getByTestId('email-action-reply-all')).toBeInTheDocument();
    expect(screen.getByTestId('email-action-forward')).toBeInTheDocument();
  });

  it('calls onComposeForMode with reply when Reply is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByTestId('email-action-reply'));
    expect(onComposeForMode).toHaveBeenCalledWith('reply');
  });

  it('calls onComposeForMode with replyAll when Reply All is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByTestId('email-action-reply-all'));
    expect(onComposeForMode).toHaveBeenCalledWith('replyAll');
  });

  it('calls onComposeForMode with forward when Forward is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByTestId('email-action-forward'));
    expect(onComposeForMode).toHaveBeenCalledWith('forward');
  });
});
