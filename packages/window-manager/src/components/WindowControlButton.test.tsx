import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WindowControlButton } from './WindowControlButton.js';

describe('WindowControlButton', () => {
  it('renders icon and label', () => {
    const { container } = render(
      <WindowControlButton icon={<svg aria-label="icon" />}>
        Upload
      </WindowControlButton>
    );

    expect(screen.getByRole('button')).toHaveTextContent('Upload');
    expect(screen.getByLabelText('icon')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(2);
  });

  it('omits icon and label wrappers when values are not provided', () => {
    const { container } = render(<WindowControlButton />);

    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('uses button type by default and supports custom type', () => {
    const { rerender } = render(
      <WindowControlButton>Action</WindowControlButton>
    );

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');

    rerender(<WindowControlButton type="submit">Action</WindowControlButton>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('applies active and custom styles', () => {
    render(
      <WindowControlButton active={true} className="custom-class">
        Action
      </WindowControlButton>
    );

    expect(screen.getByRole('button')).toHaveClass(
      'bg-background',
      'text-foreground',
      'custom-class'
    );
  });

  it('handles click and disabled states', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    const { rerender } = render(
      <WindowControlButton onClick={onClick}>Action</WindowControlButton>
    );

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <WindowControlButton onClick={onClick} disabled>
        Action
      </WindowControlButton>
    );

    expect(screen.getByRole('button')).toBeDisabled();
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
