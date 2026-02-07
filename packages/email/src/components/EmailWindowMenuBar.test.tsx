import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TestEmailProvider } from '../test/test-utils';
import { EmailWindowMenuBar } from './EmailWindowMenuBar';

describe('EmailWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list' as const,
    onViewModeChange: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn(),
    onCompose: vi.fn()
  };

  const renderWithProvider = (props = defaultProps) => {
    return render(
      <TestEmailProvider>
        <EmailWindowMenuBar {...props} />
      </TestEmailProvider>
    );
  };

  it('renders File, View, and Help menus', () => {
    renderWithProvider();

    expect(screen.getByTestId('trigger-File')).toBeInTheDocument();
    expect(screen.getByTestId('trigger-View')).toBeInTheDocument();
    expect(screen.getByTestId('trigger-Help')).toBeInTheDocument();
    expect(screen.getByTestId('about-menu-item')).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByTestId('menuitem-Refresh'));

    expect(defaultProps.onRefresh).toHaveBeenCalled();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByTestId('menuitem-Close'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onViewModeChange with list when List is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByTestId('menuitem-List'));

    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewModeChange with table when Table is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByTestId('menuitem-Table'));

    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('marks current view mode as checked', () => {
    const { rerender } = renderWithProvider();

    expect(screen.getByTestId('menuitem-List')).toHaveAttribute(
      'data-checked',
      'true'
    );
    expect(screen.getByTestId('menuitem-Table')).toHaveAttribute(
      'data-checked',
      'false'
    );

    rerender(
      <TestEmailProvider>
        <EmailWindowMenuBar {...defaultProps} viewMode="table" />
      </TestEmailProvider>
    );

    expect(screen.getByTestId('menuitem-List')).toHaveAttribute(
      'data-checked',
      'false'
    );
    expect(screen.getByTestId('menuitem-Table')).toHaveAttribute(
      'data-checked',
      'true'
    );
  });
});
