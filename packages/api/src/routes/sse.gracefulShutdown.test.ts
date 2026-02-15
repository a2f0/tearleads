import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Redis module before importing sse
vi.mock('../lib/redisPubSub.js', () => ({
  getRedisSubscriberClient: vi.fn()
}));

// Import after mocking
const { closeAllSSEConnections, addConnection, removeConnection } =
  await import('./sse.js');

describe('SSE Graceful Shutdown', () => {
  beforeEach(() => {
    // Clear any existing connections between tests
    closeAllSSEConnections();
  });

  describe('closeAllSSEConnections', () => {
    it('sends shutdown event to all active connections', () => {
      const mockWrite1 = vi.fn();
      const mockEnd1 = vi.fn();
      const mockWrite2 = vi.fn();
      const mockEnd2 = vi.fn();

      const mockRes1 = {
        write: mockWrite1,
        end: mockEnd1
      } as unknown as Response;

      const mockRes2 = {
        write: mockWrite2,
        end: mockEnd2
      } as unknown as Response;

      addConnection(mockRes1);
      addConnection(mockRes2);

      closeAllSSEConnections();

      expect(mockWrite1).toHaveBeenCalledWith(
        expect.stringContaining('event: shutdown')
      );
      expect(mockWrite1).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"server_restart"')
      );
      expect(mockEnd1).toHaveBeenCalled();

      expect(mockWrite2).toHaveBeenCalledWith(
        expect.stringContaining('event: shutdown')
      );
      expect(mockWrite2).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"server_restart"')
      );
      expect(mockEnd2).toHaveBeenCalled();
    });

    it('clears the connections set after closing', () => {
      const mockRes = {
        write: vi.fn(),
        end: vi.fn()
      } as unknown as Response;

      addConnection(mockRes);
      closeAllSSEConnections();

      // Calling again should not call write/end on the mock
      const writeCalls = (mockRes.write as ReturnType<typeof vi.fn>).mock.calls
        .length;
      const endCalls = (mockRes.end as ReturnType<typeof vi.fn>).mock.calls
        .length;

      closeAllSSEConnections();

      expect(
        (mockRes.write as ReturnType<typeof vi.fn>).mock.calls.length
      ).toBe(writeCalls);
      expect((mockRes.end as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        endCalls
      );
    });

    it('handles write errors gracefully', () => {
      const mockRes = {
        write: vi.fn().mockImplementation(() => {
          throw new Error('Write failed');
        }),
        end: vi.fn()
      } as unknown as Response;

      addConnection(mockRes);

      // Should not throw even if write fails
      expect(() => closeAllSSEConnections()).not.toThrow();
    });

    it('is safe to call when no connections exist', () => {
      expect(() => closeAllSSEConnections()).not.toThrow();
    });
  });

  describe('removeConnection', () => {
    it('removes a connection from tracking', () => {
      const mockRes = {
        write: vi.fn(),
        end: vi.fn()
      } as unknown as Response;

      addConnection(mockRes);
      removeConnection(mockRes);
      closeAllSSEConnections();

      // write/end should not have been called since connection was removed
      expect(mockRes.write).not.toHaveBeenCalled();
      expect(mockRes.end).not.toHaveBeenCalled();
    });
  });
});
