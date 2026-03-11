import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as orgStorage from './orgStorage';

const STORAGE_KEY = 'active_organization_id';

describe('orgStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    orgStorage.resetOrgStorageRuntimeForTesting();
  });

  afterEach(() => {
    orgStorage.resetOrgStorageRuntimeForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null when no org is set', () => {
    expect(orgStorage.getActiveOrganizationId()).toBeNull();
  });

  it('sets and gets the active org id', () => {
    orgStorage.setActiveOrganizationId('org-1');
    expect(orgStorage.getActiveOrganizationId()).toBe('org-1');
  });

  it('persists to localStorage on set', () => {
    orgStorage.setActiveOrganizationId('org-2');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('org-2');
  });

  it('removes from localStorage on set null', () => {
    orgStorage.setActiveOrganizationId('org-1');
    orgStorage.setActiveOrganizationId(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(orgStorage.getActiveOrganizationId()).toBeNull();
  });

  it('clears the active org id', () => {
    orgStorage.setActiveOrganizationId('org-1');
    orgStorage.clearActiveOrganizationId();
    expect(orgStorage.getActiveOrganizationId()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('initializes from localStorage on module load', async () => {
    localStorage.setItem(STORAGE_KEY, 'persisted-org');
    orgStorage.resetOrgStorageRuntimeForTesting();
    expect(orgStorage.getActiveOrganizationId()).toBe('persisted-org');
  });

  it('falls back to null on module load when localStorage read throws', async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    orgStorage.resetOrgStorageRuntimeForTesting();
    expect(orgStorage.getActiveOrganizationId()).toBeNull();

    getItemSpy.mockRestore();
  });

  it('dispatches change event on set', () => {
    const listener = vi.fn();
    window.addEventListener('tearleads_org_change', listener);
    orgStorage.setActiveOrganizationId('org-1');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('tearleads_org_change', listener);
  });

  it('dispatches change event on clear', () => {
    orgStorage.setActiveOrganizationId('org-1');
    const listener = vi.fn();
    window.addEventListener('tearleads_org_change', listener);
    orgStorage.clearActiveOrganizationId();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('tearleads_org_change', listener);
  });

  it('onOrgChange subscribes and returns unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = orgStorage.onOrgChange(listener);
    orgStorage.setActiveOrganizationId('org-1');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    orgStorage.setActiveOrganizationId('org-2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('no-ops org listeners when window is unavailable', async () => {
    vi.stubGlobal('window', undefined);
    const listener = vi.fn();
    const unsubscribe = orgStorage.onOrgChange(listener);

    expect(() =>
      orgStorage.setActiveOrganizationId('org-no-window')
    ).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps in-memory org state when localStorage write fails', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });

    expect(() => orgStorage.setActiveOrganizationId('org-err')).not.toThrow();
    expect(orgStorage.getActiveOrganizationId()).toBe('org-err');

    setItemSpy.mockRestore();
  });

  it('keeps in-memory org state when localStorage remove fails', () => {
    orgStorage.setActiveOrganizationId('org-1');

    const removeItemSpy = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    expect(() => orgStorage.setActiveOrganizationId(null)).not.toThrow();
    expect(orgStorage.getActiveOrganizationId()).toBeNull();

    removeItemSpy.mockRestore();
  });
});
