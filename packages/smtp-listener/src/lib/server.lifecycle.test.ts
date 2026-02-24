import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSmtpTestDoubles,
  resetSmtpTestDoubles
} from '../test/serverTestDoubles.js';
import { createSmtpListener } from './server.js';

const smtpTestDoubles = getSmtpTestDoubles();

describe('server lifecycle', () => {
  beforeEach(() => {
    resetSmtpTestDoubles();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSmtpListener', () => {
    it('creates a listener with default config', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      expect(listener).toBeDefined();
      expect(listener.start).toBeInstanceOf(Function);
      expect(listener.stop).toBeInstanceOf(Function);
      expect(listener.getPort).toBeInstanceOf(Function);
    });
  });

  describe('start', () => {
    it('starts the server', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();

      expect(smtpTestDoubles.mockServerListen).toHaveBeenCalledWith(
        2525,
        undefined,
        expect.any(Function)
      );
    });

    it('starts with custom host', async () => {
      const listener = await createSmtpListener({
        port: 2525,
        host: '127.0.0.1'
      });
      await listener.start();

      expect(smtpTestDoubles.mockServerListen).toHaveBeenCalledWith(
        2525,
        '127.0.0.1',
        expect.any(Function)
      );
    });

    it('handles when address returns null', async () => {
      smtpTestDoubles.mockServerAddress.mockReturnValue(null);

      const listener = await createSmtpListener({ port: 3000 });
      await listener.start();

      expect(listener.getPort()).toBe(3000);
    });

    it('handles when address returns a string', async () => {
      smtpTestDoubles.mockServerAddress.mockReturnValue('/tmp/socket.sock');

      const listener = await createSmtpListener({ port: 4000 });
      await listener.start();

      expect(listener.getPort()).toBe(4000);
    });

    it('rejects on server error', async () => {
      smtpTestDoubles.mockServerListen.mockImplementation(() => {
        // Intentionally unresolved to assert server error path.
      });
      smtpTestDoubles.mockServerOn.mockImplementation(
        (event: string, handler: (err: Error) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Port in use')), 0);
          }
        }
      );

      const listener = await createSmtpListener({ port: 2525 });
      await expect(listener.start()).rejects.toThrow('Port in use');
    });
  });

  describe('stop', () => {
    it('stops the server', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.start();
      await listener.stop();

      expect(smtpTestDoubles.mockServerClose).toHaveBeenCalled();
    });

    it('stops without prior start', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      await listener.stop();

      expect(smtpTestDoubles.mockServerClose).toHaveBeenCalled();
    });
  });

  describe('getPort', () => {
    it('returns the configured port before start', async () => {
      const listener = await createSmtpListener({ port: 2525 });
      expect(listener.getPort()).toBe(2525);
    });

    it('returns the actual port after start', async () => {
      const listener = await createSmtpListener({ port: 0 });
      await listener.start();
      expect(listener.getPort()).toBe(2525);
    });
  });
});
