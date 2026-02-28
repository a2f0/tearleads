import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logLLMAnalytics } from './analytics';

const mockGetDatabase = vi.fn();
const mockLogEvent = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => mockGetDatabase()
}));

vi.mock('@/db/analytics', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args)
}));

describe('logLLMAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs analytics when a database instance is available', async () => {
    const mockDb = { id: 'db' };
    mockGetDatabase.mockReturnValue(mockDb);

    await logLLMAnalytics('llm_prompt_text', 123, true);

    expect(mockLogEvent).toHaveBeenCalledWith(
      mockDb,
      'llm_prompt_text',
      123,
      true
    );
  });

  it('skips logging when database is unavailable', async () => {
    mockGetDatabase.mockReturnValue(null);

    await logLLMAnalytics('llm_prompt_text', 123, true);

    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it('swallows errors from database access or logging', async () => {
    mockGetDatabase.mockImplementation(() => {
      throw new Error('db failure');
    });

    await expect(
      logLLMAnalytics('llm_prompt_text', 123, true)
    ).resolves.toBeUndefined();
  });
});
