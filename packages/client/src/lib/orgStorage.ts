const STORAGE_KEY = 'active_organization_id';
const ORG_CHANGE_EVENT = 'tearleads_org_change';

let activeOrgId: string | null = null;

// Initialize from localStorage on module load
try {
  activeOrgId = localStorage.getItem(STORAGE_KEY);
} catch {
  // Ignore storage errors (SSR, private mode).
}

function notifyOrgChange(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(ORG_CHANGE_EVENT));
}

export function getActiveOrganizationId(): string | null {
  return activeOrgId;
}

export function setActiveOrganizationId(id: string | null): void {
  activeOrgId = id;
  try {
    if (id !== null) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
  notifyOrgChange();
}

export function clearActiveOrganizationId(): void {
  setActiveOrganizationId(null);
}

export function onOrgChange(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener(ORG_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(ORG_CHANGE_EVENT, listener);
  };
}
