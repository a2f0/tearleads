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

describe('list-instances command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints default instance details when database is not set up', async () => {
    vi.mocked(isDatabaseSetUp).mockResolvedValue(false);
    vi.mocked(hasPersistedSession).mockResolvedValue(false);
    vi.mocked(isDatabaseUnlocked).mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runListInstances();

    expect(logSpy).toHaveBeenCalledWith('Instances:');
    expect(logSpy).toHaveBeenCalledWith('* Default (current)');
    expect(logSpy).toHaveBeenCalledWith('  Setup:             No');
    expect(logSpy).toHaveBeenCalledWith('  Unlocked:          No');
    expect(logSpy).toHaveBeenCalledWith('  Session persisted: No');
  });

  it('prints unlocked and persisted status when available', async () => {
    vi.mocked(isDatabaseSetUp).mockResolvedValue(true);
    vi.mocked(hasPersistedSession).mockResolvedValue(true);
    vi.mocked(isDatabaseUnlocked).mockReturnValue(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runListInstances();

    expect(logSpy).toHaveBeenCalledWith('  Setup:             Yes');
    expect(logSpy).toHaveBeenCalledWith('  Unlocked:          Yes');
    expect(logSpy).toHaveBeenCalledWith('  Session persisted: Yes');
  });
});
