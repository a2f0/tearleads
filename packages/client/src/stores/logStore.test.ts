import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logStore } from './logStore';

describe('logStore', () => {
  beforeEach(() => {
    logStore.clearLogs();
  });

  afterEach(() => {
    logStore.clearLogs();
  });

  describe('addLog', () => {
    it('adds a log entry with correct properties', () => {
      logStore.addLog('info', 'Test message', 'Test details');
      const logs = logStore.getAllLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0]?.level).toBe('info');
      expect(logs[0]?.message).toBe('Test message');
      expect(logs[0]?.details).toBe('Test details');
      expect(logs[0]?.id).toBeDefined();
      expect(logs[0]?.timestamp).toBeInstanceOf(Date);
    });

    it('adds log without details', () => {
      logStore.addLog('error', 'Error message');
      const logs = logStore.getAllLogs();

      expect(logs).toHaveLength(1);
      expect(logs[0]?.details).toBeUndefined();
    });

    it('adds logs in reverse chronological order', () => {
      logStore.addLog('info', 'First');
      logStore.addLog('info', 'Second');
      logStore.addLog('info', 'Third');

      const logs = logStore.getAllLogs();
      expect(logs[0]?.message).toBe('Third');
      expect(logs[1]?.message).toBe('Second');
      expect(logs[2]?.message).toBe('First');
    });

    it('limits logs to MAX_LOGS', () => {
      for (let i = 0; i < 110; i++) {
        logStore.addLog('info', `Message ${i}`);
      }

      const logs = logStore.getAllLogs();
      expect(logs.length).toBeLessThanOrEqual(100);
    });

    it('deduplicates identical logs within time window', () => {
      logStore.addLog('error', 'Same error');
      logStore.addLog('error', 'Same error');
      logStore.addLog('error', 'Same error');

      const logs = logStore.getAllLogs();
      expect(logs).toHaveLength(1);
    });

    it('allows different messages even if same level', () => {
      logStore.addLog('error', 'Error 1');
      logStore.addLog('error', 'Error 2');

      const logs = logStore.getAllLogs();
      expect(logs).toHaveLength(2);
    });

    it('allows same message with different level', () => {
      logStore.addLog('error', 'Same message');
      logStore.addLog('warn', 'Same message');

      const logs = logStore.getAllLogs();
      expect(logs).toHaveLength(2);
    });
  });

  describe('convenience methods', () => {
    it('info adds log with info level', () => {
      logStore.info('Info message', 'Info details');
      const logs = logStore.getAllLogs();

      expect(logs[0]?.level).toBe('info');
      expect(logs[0]?.message).toBe('Info message');
    });

    it('warn adds log with warn level', () => {
      logStore.warn('Warning message');
      const logs = logStore.getAllLogs();

      expect(logs[0]?.level).toBe('warn');
    });

    it('error adds log with error level', () => {
      logStore.error('Error message', 'Stack trace');
      const logs = logStore.getAllLogs();

      expect(logs[0]?.level).toBe('error');
      expect(logs[0]?.details).toBe('Stack trace');
    });

    it('debug adds log with debug level', () => {
      logStore.debug('Debug message');
      const logs = logStore.getAllLogs();

      expect(logs[0]?.level).toBe('debug');
    });
  });

  describe('getRecentLogs', () => {
    it('returns up to specified count', () => {
      for (let i = 0; i < 30; i++) {
        logStore.addLog('info', `Message ${i}`);
      }

      const recent = logStore.getRecentLogs(10);
      expect(recent).toHaveLength(10);
    });

    it('defaults to 20 logs', () => {
      for (let i = 0; i < 30; i++) {
        logStore.addLog('info', `Message ${i}`);
      }

      const recent = logStore.getRecentLogs();
      expect(recent).toHaveLength(20);
    });

    it('returns all logs if fewer than count', () => {
      logStore.addLog('info', 'Only one');

      const recent = logStore.getRecentLogs(20);
      expect(recent).toHaveLength(1);
    });
  });

  describe('getAllLogs', () => {
    it('returns a copy of logs array', () => {
      logStore.addLog('info', 'Test');
      const logs1 = logStore.getAllLogs();
      const logs2 = logStore.getAllLogs();

      expect(logs1).not.toBe(logs2);
      expect(logs1).toEqual(logs2);
    });
  });

  describe('clearLogs', () => {
    it('removes all logs', () => {
      logStore.addLog('info', 'Test 1');
      logStore.addLog('error', 'Test 2');
      expect(logStore.getLogCount()).toBe(2);

      logStore.clearLogs();
      expect(logStore.getLogCount()).toBe(0);
      expect(logStore.getAllLogs()).toEqual([]);
    });
  });

  describe('getLogCount', () => {
    it('returns correct count', () => {
      expect(logStore.getLogCount()).toBe(0);

      logStore.addLog('info', 'Test');
      expect(logStore.getLogCount()).toBe(1);

      logStore.addLog('error', 'Test 2');
      expect(logStore.getLogCount()).toBe(2);
    });
  });

  describe('subscribe', () => {
    it('calls listener when log is added', () => {
      const listener = vi.fn();
      logStore.subscribe(listener);

      logStore.addLog('info', 'Test');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listener when logs are cleared', () => {
      const listener = vi.fn();
      logStore.subscribe(listener);

      logStore.clearLogs();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = logStore.subscribe(listener);

      logStore.addLog('info', 'Test 1');
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      logStore.addLog('info', 'Test 2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      logStore.subscribe(listener1);
      logStore.subscribe(listener2);

      logStore.addLog('info', 'Test');

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });
});
