import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSwitcher } from './AccountSwitcher';

// Mock functions for tracking calls
const mockCreateInstance = vi.fn(async () => 'new-instance');
const mockSwitchInstance = vi.fn(async () => true);
const mockDeleteInstance = vi.fn(async () => {});

// Default mock values
const defaultMockContext = {
  currentInstanceId: 'test-instance',
  currentInstanceName: 'Instance 1',
  instances: [
    {
      id: 'test-instance',
      name: 'Instance 1',
      createdAt: new Date('2023-01-01T00:00:00.000Z').getTime(),
      lastAccessedAt: new Date('2023-01-01T00:00:00.000Z').getTime()
    },
    {
      id: 'second-instance',
      name: 'Instance 2',
      createdAt: new Date('2023-01-01T00:00:00.000Z').getTime(),
      lastAccessedAt: new Date('2023-01-01T00:00:00.000Z').getTime()
    }
  ],
  createInstance: mockCreateInstance,
  switchInstance: mockSwitchInstance,
  deleteInstance: mockDeleteInstance,
  refreshInstances: vi.fn(async () => {}),
  isLoading: false,
  isUnlocked: false
};

// Mock the database context
const mockUseDatabaseContext = vi.fn(() => defaultMockContext);
vi.mock('@/db/hooks/useDatabase', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

describe('AccountSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue(defaultMockContext);
  });

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

    // Check for instance names in dropdown (Instance 1 appears twice - in button and dropdown)
    expect(screen.getAllByText('Instance 1')).toHaveLength(2);
    expect(screen.getByText('Instance 2')).toBeInTheDocument();
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
    expect(screen.getByText('Create new instance')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /close account menu/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Create new instance')).not.toBeInTheDocument();
    });
  });

  it('closes dropdown when Escape key is pressed', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Create new instance')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Create new instance')).not.toBeInTheDocument();
    });
  });

  it('closes dropdown when toggle button is clicked again', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Create new instance')).toBeInTheDocument();

    await user.click(screen.getByTestId('account-switcher-button'));

    await waitFor(() => {
      expect(screen.queryByText('Create new instance')).not.toBeInTheDocument();
    });
  });

  it('calls createInstance when New Instance is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByText('Create new instance'));

    expect(mockCreateInstance).toHaveBeenCalled();
  });

  it('calls switchInstance when a different instance is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByText('Instance 2'));

    expect(mockSwitchInstance).toHaveBeenCalledWith('second-instance');
  });

  it('closes dropdown after New Instance is clicked', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    await user.click(screen.getByText('Create new instance'));

    await waitFor(() => {
      expect(screen.queryByText('Create new instance')).not.toBeInTheDocument();
    });
  });

  it('shows checkmark for active instance', async () => {
    const user = userEvent.setup();
    render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));

    // The active instance should have a checkmark (SVG)
    const instanceButtons = screen.getAllByRole('button');
    const activeButton = instanceButtons.find((btn) =>
      btn.textContent?.includes('Instance 1')
    );
    expect(activeButton?.querySelector('svg')).toBeInTheDocument();
  });

  it('cleans up event listener on unmount when open', async () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const user = userEvent.setup();

    const { unmount } = render(<AccountSwitcher />);

    await user.click(screen.getByTestId('account-switcher-button'));
    expect(screen.getByText('Create new instance')).toBeInTheDocument();

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

    const menu = screen.getByText('Create new instance').closest('div[style]');
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

    const menu = screen.getByText('Create new instance').closest('div[style]');

    // Menu should be repositioned to avoid overflow
    await waitFor(() => {
      const style = menu?.getAttribute('style');
      const topValue = style
        ? parseFloat(style.match(/top: ([\d.]+)px/)?.[1] ?? '490')
        : 490;
      expect(topValue).toBeLessThan(490);
    });

    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  describe('lock status indicators', () => {
    it('shows lock icon for current instance when database is locked', async () => {
      const user = userEvent.setup();

      render(<AccountSwitcher />);
      await user.click(screen.getByTestId('account-switcher-button'));

      expect(
        screen.getByTestId('instance-locked-test-instance')
      ).toBeInTheDocument();
    });

    it('shows unlock icon for current instance when database is unlocked', async () => {
      const user = userEvent.setup();
      mockUseDatabaseContext.mockReturnValue({
        ...defaultMockContext,
        isUnlocked: true
      });

      render(<AccountSwitcher />);
      await user.click(screen.getByTestId('account-switcher-button'));

      expect(
        screen.getByTestId('instance-unlocked-test-instance')
      ).toBeInTheDocument();
    });

    it('shows lock icon for non-current instances regardless of unlock status', async () => {
      const user = userEvent.setup();
      mockUseDatabaseContext.mockReturnValue({
        ...defaultMockContext,
        isUnlocked: true
      });

      render(<AccountSwitcher />);
      await user.click(screen.getByTestId('account-switcher-button'));

      // Second instance should always show locked
      expect(
        screen.getByTestId('instance-locked-second-instance')
      ).toBeInTheDocument();
    });
  });

  describe('delete functionality', () => {
    it('shows delete buttons when there are multiple instances', async () => {
      const user = userEvent.setup();
      render(<AccountSwitcher />);

      await user.click(screen.getByTestId('account-switcher-button'));

      expect(
        screen.getByTestId('delete-instance-test-instance')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('delete-instance-second-instance')
      ).toBeInTheDocument();
    });

    it('does not show delete buttons when there is only one instance', async () => {
      const user = userEvent.setup();
      mockUseDatabaseContext.mockReturnValue({
        ...defaultMockContext,
        instances: [
          {
            id: 'test-instance',
            name: 'Instance 1',
            createdAt: new Date('2023-01-01T00:00:00.000Z').getTime(),
            lastAccessedAt: new Date('2023-01-01T00:00:00.000Z').getTime()
          }
        ]
      });

      render(<AccountSwitcher />);

      await user.click(screen.getByTestId('account-switcher-button'));

      expect(
        screen.queryByTestId('delete-instance-test-instance')
      ).not.toBeInTheDocument();
    });

    it('opens delete dialog when delete button is clicked', async () => {
      const user = userEvent.setup();
      render(<AccountSwitcher />);

      await user.click(screen.getByTestId('account-switcher-button'));
      await user.click(screen.getByTestId('delete-instance-second-instance'));

      // Delete dialog should be visible
      await waitFor(() => {
        expect(
          screen.getByText(/are you sure you want to delete/i)
        ).toBeInTheDocument();
      });
    });

    it('closes dropdown when delete button is clicked', async () => {
      const user = userEvent.setup();
      render(<AccountSwitcher />);

      await user.click(screen.getByTestId('account-switcher-button'));
      expect(screen.getByText('Create new instance')).toBeInTheDocument();

      await user.click(screen.getByTestId('delete-instance-second-instance'));

      // Dropdown should be closed
      await waitFor(() => {
        expect(
          screen.queryByText('Create new instance')
        ).not.toBeInTheDocument();
      });
    });

    it('passes correct instance name to delete dialog', async () => {
      const user = userEvent.setup();
      render(<AccountSwitcher />);

      await user.click(screen.getByTestId('account-switcher-button'));
      await user.click(screen.getByTestId('delete-instance-second-instance'));

      await waitFor(() => {
        expect(screen.getByText(/Instance 2/)).toBeInTheDocument();
      });
    });
  });

  describe('disabled state', () => {
    it('disables button when loading', () => {
      mockUseDatabaseContext.mockReturnValue({
        ...defaultMockContext,
        isLoading: true
      });

      render(<AccountSwitcher />);

      expect(screen.getByTestId('account-switcher-button')).toBeDisabled();
    });
  });

  describe('instance switching', () => {
    it('does not call switchInstance when clicking the current instance', async () => {
      const user = userEvent.setup();
      render(<AccountSwitcher />);

      await user.click(screen.getByTestId('account-switcher-button'));
      await user.click(screen.getByTestId('instance-test-instance'));

      expect(mockSwitchInstance).not.toHaveBeenCalled();
    });
  });
});
