import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('renders as password type by default', () => {
    render(<PasswordInput placeholder="Enter password" />);

    expect(screen.getByPlaceholderText('Enter password')).toHaveAttribute(
      'type',
      'password'
    );
  });

  it('toggles to text type when show button is clicked', async () => {
    const user = userEvent.setup();
    render(<PasswordInput placeholder="Enter password" />);

    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('uses custom ariaLabelBase', async () => {
    const user = userEvent.setup();
    render(
      <PasswordInput
        placeholder="Confirm"
        ariaLabelBase="confirm password"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Show confirm password' })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Show confirm password' })
    );
    expect(
      screen.getByRole('button', { name: 'Hide confirm password' })
    ).toBeInTheDocument();
  });

  it('forwards ref to the input element', () => {
    const ref = { current: null } as React.RefObject<HTMLInputElement | null>;
    render(<PasswordInput ref={ref} placeholder="Password" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
