import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'active_organization_id';

// Reset module state between tests by re-importing
let orgStorage: typeof import('./orgStorage');

describe('orgStorage', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    orgStorage = await import('./orgStorage');
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    vi.resetModules();
    const freshModule = await import('./orgStorage');
    expect(freshModule.getActiveOrganizationId()).toBe('persisted-org');
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
});
