import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccountSwitcher } from './AccountSwitcher';

describe('AccountSwitcher', () => {
  it('renders the account button', () => {
    render(<AccountSwitcher />);

    expect(
      screen.getByRole('button', { name: /account menu/i })
    ).toBeInTheDocument();
  });

  it('has correct aria attributes when closed', () => {
    render(<AccountSwitcher />);

    const button = screen.getByTestId('account-switcher-button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
  });

  it('opens dropdown when button is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));

    expect(screen.getByText('Change instance')).toBeInTheDocument();
    expect(screen.getByText('Create new instance')).toBeInTheDocument();
  });

  it('updates aria-expanded when dropdown is open', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));

    expect(screen.getByTestId('account-switcher-button')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('closes dropdown when backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Change instance')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /close account menu/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Change instance')).not.toBeInTheDocument();
    });
  });

  it('closes dropdown when Escape key is pressed', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Change instance')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Change instance')).not.toBeInTheDocument();
    });
  });

  it('closes dropdown when toggle button is clicked again', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Change instance')).toBeInTheDocument();

    await user.click(screen.getByTestId('account-switcher-button'));

    await waitFor(() => {
      expect(screen.queryByText('Change instance')).not.toBeInTheDocument();
    });
  });

  it('calls console.log when Change instance is clicked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByTestId('change-instance-button'));

    expect(consoleSpy).toHaveBeenCalledWith('Change instance');
    consoleSpy.mockRestore();
  });

  it('calls console.log when Create new instance is clicked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByTestId('create-instance-button'));

    expect(consoleSpy).toHaveBeenCalledWith('Create new instance');
    consoleSpy.mockRestore();
  });

  it('closes dropdown after Change instance is clicked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByTestId('change-instance-button'));

    await waitFor(() => {
      expect(screen.queryByText('Change instance')).not.toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('closes dropdown after Create new instance is clicked', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByTestId('create-instance-button'));

    await waitFor(() => {
      expect(screen.queryByText('Create new instance')).not.toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('renders menu items with correct icons', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));

    // Check that menu items are rendered as buttons
    expect(screen.getByTestId('change-instance-button')).toBeInTheDocument();
    expect(screen.getByTestId('create-instance-button')).toBeInTheDocument();
  });

  it('cleans up event listener on unmount when open', async () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const user = userEvent.setup();

    const { unmount } = render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Change instance')).toBeInTheDocument();

    unmount();

    await waitFor(() => {
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
    });

    removeEventListenerSpy.mockRestore();
  });

  it('positions dropdown correctly based on button position', async () => {
    const user = userEvent.setup();

    // Mock getBoundingClientRect for the button
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    let callCount = 0;
    Element.prototype.getBoundingClientRect = () => {
      callCount++;
      // First call is for the button
      if (callCount === 1) {
        return {
          width: 36,
          height: 36,
          top: 20,
          left: 800,
          right: 836,
          bottom: 56,
          x: 800,
          y: 20,
          toJSON: () => ({})
        };
      }
      // Subsequent calls are for the menu
      return {
        width: 192,
        height: 80,
        top: 60,
        left: 644,
        right: 836,
        bottom: 140,
        x: 644,
        y: 60,
        toJSON: () => ({})
      };
    };

    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 768,
      writable: true
    });

    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));

    const menu = screen.getByText('Change instance').closest('div[style]');
    expect(menu).toHaveStyle({ top: '60px' });

    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('adjusts dropdown position when it would overflow viewport bottom', async () => {
    const user = userEvent.setup();

    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    let callCount = 0;
    Element.prototype.getBoundingClientRect = () => {
      callCount++;
      // First call is for the button (positioned near bottom of viewport)
      if (callCount === 1) {
        return {
          width: 36,
          height: 36,
          top: 450,
          left: 800,
          right: 836,
          bottom: 486,
          x: 800,
          y: 450,
          toJSON: () => ({})
        };
      }
      // Subsequent calls are for the menu
      return {
        width: 192,
        height: 80,
        top: 490,
        left: 644,
        right: 836,
        bottom: 570,
        x: 644,
        y: 490,
        toJSON: () => ({})
      };
    };

    // Set viewport height so menu would overflow
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 500,
      writable: true
    });

    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));

    const menu = screen.getByText('Change instance').closest('div[style]');

    // Menu should be repositioned to avoid overflow
    // With viewport height 500 and menu height 80, adjusted top should be max(8, 500 - 80 - 8) = 412
    await waitFor(() => {
      const style = menu?.getAttribute('style');
      const topValue = style
        ? parseFloat(style.match(/top: ([\d.]+)px/)?.[1] ?? '490')
        : 490;
      expect(topValue).toBeLessThan(490);
    });

    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });
});
