import { describe, expect, it } from 'vitest';
import { shouldFailOnConsoleMessage } from './consoleGuardPatterns';

describe('consoleGuardPatterns', () => {
  it('matches rematerialization and flush warning signatures', () => {
    expect(
      shouldFailOnConsoleMessage(
        'VFS rematerialization bootstrap failed: page.items is undefined'
      )
    ).toBe(true);
    expect(
      shouldFailOnConsoleMessage(
        'Initial VFS orchestrator flush failed: Error: transport returned invalid hasMore'
      )
    ).toBe(true);
    expect(
      shouldFailOnConsoleMessage(
        'VfsCrdtFeedReplayError: CRDT feed item 0 is not strictly newer than local cursor'
      )
    ).toBe(true);
  });

  it('ignores unrelated logs', () => {
    expect(shouldFailOnConsoleMessage('sync loop completed successfully')).toBe(
      false
    );
    expect(shouldFailOnConsoleMessage('debug: fetched 5 items')).toBe(false);
  });
});
