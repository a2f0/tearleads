import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthInstanceBinding } from './AuthInstanceBinding';

const mockUseAuth = vi.fn();
const mockUseDatabaseContext = vi.fn();
const mockGetInstanceForUser = vi.fn();
const mockGetInstance = vi.fn();
const mockBindInstanceToUser = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/instanceRegistry', () => ({
  getInstanceForUser: (...args: unknown[]) => mockGetInstanceForUser(...args),
  getInstance: (...args: unknown[]) => mockGetInstance(...args),
  bindInstanceToUser: (...args: unknown[]) => mockBindInstanceToUser(...args)
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
      boundUserId: null
    });
    mockBindInstanceToUser.mockResolvedValue(undefined);
  });

  it('binds current unbound instance on first login', async () => {
    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(mockBindInstanceToUser).toHaveBeenCalledWith(
        'instance-current',
        'user-1'
      );
    });
    expect(switchInstance).not.toHaveBeenCalled();
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('switches to an already bound user instance', async () => {
    mockGetInstanceForUser.mockResolvedValue({
      id: 'instance-user-1',
      boundUserId: 'user-1'
    });

    render(<AuthInstanceBinding />);

    await waitFor(() => {
      expect(switchInstance).toHaveBeenCalledWith('instance-user-1');
    });
    expect(mockBindInstanceToUser).not.toHaveBeenCalled();
  });

  it('creates and binds a new instance when current belongs to another user', async () => {
    mockGetInstance.mockResolvedValue({
      id: 'instance-current',
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
  });
});
