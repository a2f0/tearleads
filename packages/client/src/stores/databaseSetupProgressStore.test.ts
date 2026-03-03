import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseSetupProgressStore } from './databaseSetupProgressStore';

describe('databaseSetupProgressStore', () => {
  afterEach(() => {
    databaseSetupProgressStore.finish();
  });

  describe('start', () => {
    it('sets isActive to true and initializes step', () => {
      databaseSetupProgressStore.start();

      expect(databaseSetupProgressStore.getIsActive()).toBe(true);
      expect(databaseSetupProgressStore.getSnapshot()).toEqual({
        label: 'Initializing...',
        progress: 0
      });
    });
  });

  describe('update', () => {
    it('updates label and progress', () => {
      databaseSetupProgressStore.start();
      databaseSetupProgressStore.update('Loading engine...', 50);

      expect(databaseSetupProgressStore.getSnapshot()).toEqual({
        label: 'Loading engine...',
        progress: 50
      });
    });

    it('clamps progress to 0-100 range', () => {
      databaseSetupProgressStore.start();

      databaseSetupProgressStore.update('Under', -10);
      expect(databaseSetupProgressStore.getSnapshot()?.progress).toBe(0);

      databaseSetupProgressStore.update('Over', 150);
      expect(databaseSetupProgressStore.getSnapshot()?.progress).toBe(100);
    });
  });

  describe('finish', () => {
    it('sets isActive to false and clears step', () => {
      databaseSetupProgressStore.start();
      databaseSetupProgressStore.update('Working...', 50);
      databaseSetupProgressStore.finish();

      expect(databaseSetupProgressStore.getIsActive()).toBe(false);
      expect(databaseSetupProgressStore.getSnapshot()).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('notifies listeners on start', () => {
      const listener = vi.fn();
      const unsubscribe = databaseSetupProgressStore.subscribe(listener);

      databaseSetupProgressStore.start();
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('notifies listeners on update', () => {
      const listener = vi.fn();
      const unsubscribe = databaseSetupProgressStore.subscribe(listener);

      databaseSetupProgressStore.update('Step 1', 25);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('notifies listeners on finish', () => {
      const listener = vi.fn();
      const unsubscribe = databaseSetupProgressStore.subscribe(listener);

      databaseSetupProgressStore.finish();
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('returns unsubscribe function that stops notifications', () => {
      const listener = vi.fn();
      const unsubscribe = databaseSetupProgressStore.subscribe(listener);

      databaseSetupProgressStore.start();
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      databaseSetupProgressStore.update('No notification', 50);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsub1 = databaseSetupProgressStore.subscribe(listener1);
      const unsub2 = databaseSetupProgressStore.subscribe(listener2);

      databaseSetupProgressStore.start();

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      unsub1();
      unsub2();
    });
  });

  describe('getSnapshot', () => {
    it('returns null when not started', () => {
      expect(databaseSetupProgressStore.getSnapshot()).toBeNull();
    });

    it('returns current step when active', () => {
      databaseSetupProgressStore.start();
      databaseSetupProgressStore.update('Running migrations...', 85);

      expect(databaseSetupProgressStore.getSnapshot()).toEqual({
        label: 'Running migrations...',
        progress: 85
      });
    });
  });
});
