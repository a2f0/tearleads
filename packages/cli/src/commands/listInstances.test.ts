import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasPersistedSession,
  isDatabaseSetUp,
  isDatabaseUnlocked
} from '../db/index.js';
import { runListInstances } from './listInstances.js';

vi.mock('../db/index.js', () => ({
  isDatabaseSetUp: vi.fn(),
  hasPersistedSession: vi.fn(),
  isDatabaseUnlocked: vi.fn()
}));

function getDbStatusMocks() {
  if (
    !vi.isMockFunction(isDatabaseSetUp) ||
    !vi.isMockFunction(hasPersistedSession) ||
    !vi.isMockFunction(isDatabaseUnlocked)
  ) {
    throw new Error('database status mocks are not configured');
  }
  return {
    isDatabaseSetUp,
    hasPersistedSession,
    isDatabaseUnlocked
  };
}

describe('list-instances command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints default instance details when database is not set up', async () => {
    const dbStatusMocks = getDbStatusMocks();
    dbStatusMocks.isDatabaseSetUp.mockResolvedValue(false);
    dbStatusMocks.hasPersistedSession.mockResolvedValue(false);
    dbStatusMocks.isDatabaseUnlocked.mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runListInstances();

    expect(logSpy).toHaveBeenCalledWith('Instances:');
    expect(logSpy).toHaveBeenCalledWith('* Default (current)');
    expect(logSpy).toHaveBeenCalledWith('  Setup:             No');
    expect(logSpy).toHaveBeenCalledWith('  Unlocked:          No');
    expect(logSpy).toHaveBeenCalledWith('  Session persisted: No');
  });

  it('prints unlocked and persisted status when available', async () => {
    const dbStatusMocks = getDbStatusMocks();
    dbStatusMocks.isDatabaseSetUp.mockResolvedValue(true);
    dbStatusMocks.hasPersistedSession.mockResolvedValue(true);
    dbStatusMocks.isDatabaseUnlocked.mockReturnValue(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runListInstances();

    expect(logSpy).toHaveBeenCalledWith('  Setup:             Yes');
    expect(logSpy).toHaveBeenCalledWith('  Unlocked:          Yes');
    expect(logSpy).toHaveBeenCalledWith('  Session persisted: Yes');
  });
});
