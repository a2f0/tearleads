import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShareForm } from './ShareForm';

vi.mock('../../context', () => ({
  useVfsExplorerContext: () => ({
    ui: {
      Button: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => <button {...props}>{children}</button>,
      Input: (props: Record<string, unknown>) => <input {...props} />
    }
  })
}));

vi.mock('../../hooks', () => ({
  useShareTargetSearch: () => ({
    results: [],
    loading: false,
    search: vi.fn(),
    clear: vi.fn()
  })
}));

describe('ShareForm', () => {
  const defaultProps = {
    onShareCreated: vi.fn(),
    onCancel: vi.fn(),
    onTargetSelected: vi.fn(),
    createShare: vi.fn(async () => ({}))
  };

  it('renders share type buttons', () => {
    render(<ShareForm {...defaultProps} />);

    expect(screen.getByTestId('share-type-user')).toBeInTheDocument();
    expect(screen.getByTestId('share-type-group')).toBeInTheDocument();
    expect(screen.getByTestId('share-type-organization')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<ShareForm {...defaultProps} />);
    expect(screen.getByTestId('share-target-search')).toBeInTheDocument();
  });

  it('submit button is disabled without target', () => {
    render(<ShareForm {...defaultProps} />);
    expect(screen.getByTestId('share-form-submit')).toBeDisabled();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ShareForm {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('switches share type and notifies parent', async () => {
    const onTargetSelected = vi.fn();
    const user = userEvent.setup();
    render(
      <ShareForm {...defaultProps} onTargetSelected={onTargetSelected} />
    );

    await user.click(screen.getByTestId('share-type-group'));
    expect(onTargetSelected).toHaveBeenCalledWith('group', null, '');
  });

  it('always shows tab labels', () => {
    render(<ShareForm {...defaultProps} />);
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
    expect(screen.getByText('Org')).toBeInTheDocument();
  });
});
