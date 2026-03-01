import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SharePermissionSelect } from './SharePermissionSelect';

describe('SharePermissionSelect', () => {
  it('renders current value', () => {
    render(<SharePermissionSelect value="view" onChange={vi.fn()} />);
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('opens dropdown on click', async () => {
    const user = userEvent.setup();
    render(<SharePermissionSelect value="view" onChange={vi.fn()} />);

    await user.click(screen.getByTestId('permission-select-trigger'));
    expect(
      screen.getByTestId('permission-select-dropdown')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Can view this item and its contents')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Can view, edit, and organize this item')
    ).toBeInTheDocument();
  });

  it('calls onChange with selected value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SharePermissionSelect value="view" onChange={onChange} />);

    await user.click(screen.getByTestId('permission-select-trigger'));
    await user.click(screen.getByTestId('permission-option-edit'));

    expect(onChange).toHaveBeenCalledWith('edit');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<SharePermissionSelect value="view" onChange={vi.fn()} disabled />);

    await user.click(screen.getByTestId('permission-select-trigger'));
    expect(
      screen.queryByTestId('permission-select-dropdown')
    ).not.toBeInTheDocument();
  });
});
