import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthInstanceBinding } from './AuthInstanceBinding';

const mockUseAuth = vi.fn();
const mockUseDatabaseContext = vi.fn();
const mockGetInstanceForUser = vi.fn();
const mockGetInstance = vi.fn();
const mockBindInstanceToUser = vi.fn();
const mockUpdateInstance = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/instanceRegistry', () => ({
  getInstanceForUser: (...args: unknown[]) => mockGetInstanceForUser(...args),
  getInstance: (...args: unknown[]) => mockGetInstance(...args),
  bindInstanceToUser: (...args: unknown[]) => mockBindInstanceToUser(...args),
  updateInstance: (...args: unknown[]) => mockUpdateInstance(...args)
}));

describe('AuthInstanceBinding', () => {
  const switchInstance = vi.fn(async () => true);
  const createInstance = vi.fn(async () => 'instance-new');
  const refreshInstances = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'user-1@example.com' },
      isAuthenticated: true,
      isLoading: false
    });
    mockUseDatabaseContext.mockReturnValue({
      isLoading: false,
      currentInstanceId: 'instance-current',
      switchInstance,
      createInstance,
      refreshInstances
    });
    mockGetInstanceForUser.mockResolvedValue(null);
    mockGetInstance.mockResolvedValue({
      id: 'instance-current',
      name: 'Instance 1',
      boundUserId: null
    });
    mockBindInstanceToUser.mockResolvedValue(undefined);
    mockUpdateInstance.mockResolvedValue(undefined);
  });

  it('binds current unbound instance on first login', async () => {
    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(mockBindInstanceToUser).toHaveBeenCalledWith(
        'instance-current',
        'user-1'
      );
    });
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-current', {
      name: 'user-1@example.com'
    });
    expect(switchInstance).not.toHaveBeenCalled();
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('switches to an already bound user instance', async () => {
    mockGetInstanceForUser.mockResolvedValue({
      id: 'instance-user-1',
      name: 'Instance 2',
      boundUserId: 'user-1'
    });

    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(switchInstance).toHaveBeenCalledWith('instance-user-1');
    });
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-user-1', {
      name: 'user-1@example.com'
    });
    expect(mockBindInstanceToUser).not.toHaveBeenCalled();
  });

  it('creates and binds a new instance when current belongs to another user', async () => {
    mockGetInstance.mockResolvedValue({
      id: 'instance-current',
      name: 'Instance 1',
      boundUserId: 'user-2'
    });

    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(createInstance).toHaveBeenCalledTimes(1);
    });
    expect(mockBindInstanceToUser).toHaveBeenCalledWith(
      'instance-new',
      'user-1'
    );
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-new', {
      name: 'user-1@example.com'
    });
  });

  it('creates a new instance when switching from user-1 to user-2', async () => {
    // User-1 logs in, current instance is unbound → bind to user-1
    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(mockBindInstanceToUser).toHaveBeenCalledWith(
        'instance-current',
        'user-1'
      );
    });

    // Clear mocks and switch to user-2
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'user-2', email: 'user-2@example.com' },
      isAuthenticated: true,
      isLoading: false
    });
    mockUseDatabaseContext.mockReturnValue({
      isLoading: false,
      currentInstanceId: 'instance-current',
      switchInstance,
      createInstance,
      refreshInstances
    });
    // Current instance now bound to user-1
    mockGetInstanceForUser.mockResolvedValue(null);
    mockGetInstance.mockResolvedValue({
      id: 'instance-current',
      name: 'user-1@example.com',
      boundUserId: 'user-1'
    });
    createInstance.mockResolvedValue('instance-new-2');
    mockUpdateInstance.mockResolvedValue(undefined);

    // Force rerender by remounting
    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(createInstance).toHaveBeenCalledTimes(1);
    });
    expect(mockBindInstanceToUser).toHaveBeenCalledWith(
      'instance-new-2',
      'user-2'
    );
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-new-2', {
      name: 'user-2@example.com'
    });
  });

  it('updates instance name when email changes on re-login', async () => {
    mockGetInstance.mockResolvedValue({
      id: 'instance-current',
      name: 'old@example.com',
      boundUserId: 'user-1'
    });
    mockGetInstanceForUser.mockResolvedValue(null);

    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(mockUpdateInstance).toHaveBeenCalledWith('instance-current', {
        name: 'user-1@example.com'
      });
    });
  });

  it('bails out when current instance is missing from registry', async () => {
    mockGetInstance.mockResolvedValue(null);

    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(mockGetInstance).toHaveBeenCalledWith('instance-current');
    });
    expect(switchInstance).not.toHaveBeenCalled();
    expect(createInstance).not.toHaveBeenCalled();
    expect(mockBindInstanceToUser).not.toHaveBeenCalled();
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });
});
