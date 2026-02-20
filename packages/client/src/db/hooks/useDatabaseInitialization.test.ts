import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAndRestoreDatabaseState } from './useDatabaseInitialization';

const mockEmitInstanceChange = vi.fn();
const mockToError = vi.fn();
const mockLogWarn = vi.fn();
const mockNotificationWarning = vi.fn();
const mockValidateAndPruneOrphanedInstances = vi.fn();
const mockHasPersistedSession = vi.fn();
const mockIsDatabaseSetUp = vi.fn();
const mockRestoreDatabaseSession = vi.fn();
const mockDeleteInstanceFromRegistry = vi.fn();
const mockGetInstances = vi.fn();
const mockInitializeRegistry = vi.fn();
const mockSetActiveInstanceId = vi.fn();
const mockTouchInstance = vi.fn();

vi.mock('@/hooks/app', () => ({
  emitInstanceChange: (...args: unknown[]) => mockEmitInstanceChange(...args)
}));

vi.mock('@/lib/errors', () => ({
  toError: (...args: unknown[]) => mockToError(...args)
}));

vi.mock('@/stores/logStore', () => ({
  logStore: {
    warn: (...args: unknown[]) => mockLogWarn(...args)
  }
}));

vi.mock('@/stores/notificationStore', () => ({
  notificationStore: {
    warning: (...args: unknown[]) => mockNotificationWarning(...args)
  }
}));

vi.mock('../crypto/keyManager', () => ({
  validateAndPruneOrphanedInstances: (...args: unknown[]) =>
    mockValidateAndPruneOrphanedInstances(...args)
}));

vi.mock('../index', () => ({
  hasPersistedSession: (...args: unknown[]) => mockHasPersistedSession(...args),
  isDatabaseSetUp: (...args: unknown[]) => mockIsDatabaseSetUp(...args),
  restoreDatabaseSession: (...args: unknown[]) =>
    mockRestoreDatabaseSession(...args)
}));

vi.mock('../instanceRegistry', () => ({
  deleteInstanceFromRegistry: (...args: unknown[]) =>
    mockDeleteInstanceFromRegistry(...args),
  getInstances: (...args: unknown[]) => mockGetInstances(...args),
  initializeRegistry: (...args: unknown[]) => mockInitializeRegistry(...args),
  setActiveInstanceId: (...args: unknown[]) => mockSetActiveInstanceId(...args),
  touchInstance: (...args: unknown[]) => mockTouchInstance(...args)
}));

function createOptions(hadActiveSession = false) {
  return {
    hadActiveSession,
    hasShownRecoveryNotification: { current: false },
    setCurrentInstanceId: vi.fn(),
    setCurrentInstanceName: vi.fn(),
    setDb: vi.fn(),
    setError: vi.fn(),
    setHasPersisted: vi.fn(),
    setInstances: vi.fn(),
    setIsLoading: vi.fn(),
    setIsSetUp: vi.fn(),
    markSessionActive: vi.fn()
  };
}

describe('initializeAndRestoreDatabaseState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToError.mockImplementation((error: unknown) => {
      if (error instanceof Error) {
        return error;
      }
      return new Error(String(error));
    });
  });

  it('initializes and updates instance state without recovery warning', async () => {
    const active = { id: 'active-1', name: 'Primary' };
    mockInitializeRegistry.mockResolvedValue(active);
    mockGetInstances.mockResolvedValue([active]);
    mockValidateAndPruneOrphanedInstances.mockResolvedValue({
      cleaned: false,
      orphanedKeystoreEntries: [],
      orphanedRegistryEntries: []
    });
    mockIsDatabaseSetUp.mockResolvedValue(false);
    mockHasPersistedSession.mockResolvedValue(false);

    const options = createOptions();
    await initializeAndRestoreDatabaseState(options);

    expect(options.setInstances).toHaveBeenCalledWith([active]);
    expect(options.setCurrentInstanceId).toHaveBeenCalledWith('active-1');
    expect(options.setCurrentInstanceName).toHaveBeenCalledWith('Primary');
    expect(mockEmitInstanceChange).toHaveBeenCalledWith('active-1');
    expect(options.setIsSetUp).toHaveBeenCalledWith(false);
    expect(options.setHasPersisted).toHaveBeenCalledWith(false);
    expect(mockNotificationWarning).not.toHaveBeenCalled();
    expect(options.setIsLoading).toHaveBeenCalledWith(false);
  });

  it('warns and clears persisted flag when session restore fails', async () => {
    const active = { id: 'active-1', name: 'Primary' };
    mockInitializeRegistry.mockResolvedValue(active);
    mockGetInstances.mockResolvedValue([active]);
    mockValidateAndPruneOrphanedInstances.mockResolvedValue({
      cleaned: false,
      orphanedKeystoreEntries: [],
      orphanedRegistryEntries: []
    });
    mockIsDatabaseSetUp.mockResolvedValue(true);
    mockHasPersistedSession.mockResolvedValue(true);
    mockRestoreDatabaseSession.mockResolvedValue(null);

    const options = createOptions(true);
    await initializeAndRestoreDatabaseState(options);

    expect(options.setHasPersisted).toHaveBeenCalledWith(true);
    expect(options.setHasPersisted).toHaveBeenCalledWith(false);
    expect(mockNotificationWarning).toHaveBeenCalledWith(
      'Unexpected Reload',
      'App reloaded unexpectedly. Please unlock your database to continue.'
    );
    expect(options.hasShownRecoveryNotification.current).toBe(true);
  });

  it('reassigns active instance and logs orphan cleanup warnings', async () => {
    const initialActive = { id: 'removed', name: 'Removed' };
    const remaining = { id: 'remaining', name: 'Remaining' };
    mockInitializeRegistry.mockResolvedValue(initialActive);
    mockGetInstances
      .mockResolvedValueOnce([initialActive])
      .mockResolvedValueOnce([remaining]);
    mockValidateAndPruneOrphanedInstances.mockResolvedValue({
      cleaned: true,
      orphanedKeystoreEntries: ['k1'],
      orphanedRegistryEntries: ['r1']
    });
    mockIsDatabaseSetUp.mockResolvedValue(false);
    mockHasPersistedSession.mockResolvedValue(false);

    const options = createOptions();
    await initializeAndRestoreDatabaseState(options);

    expect(mockLogWarn).toHaveBeenCalledTimes(2);
    expect(mockSetActiveInstanceId).toHaveBeenCalledWith('remaining');
    expect(options.setCurrentInstanceId).toHaveBeenCalledWith('remaining');
    expect(options.setInstances).toHaveBeenCalledWith([remaining]);
  });

  it('maps thrown errors and always clears loading state', async () => {
    const mappedError = new Error('mapped');
    mockInitializeRegistry.mockRejectedValue(new Error('boom'));
    mockToError.mockReturnValue(mappedError);

    const options = createOptions();
    await initializeAndRestoreDatabaseState(options);

    expect(options.setError).toHaveBeenCalledWith(mappedError);
    expect(options.setIsLoading).toHaveBeenCalledWith(false);
  });
});
