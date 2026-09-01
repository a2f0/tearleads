import type { Tearleads } from "@tearleads/client-sdk";

/** Detach auth and events before publishing a different signing identity. */
function clearSessionForIdentityTransition(tearleads: Tearleads): void {
  tearleads.events.clear();
  tearleads.session.setContext({
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  });
}

/** Stop identity-scoped work and detach the old session before changing keys. */
export function prepareForIdentityTransition(tearleads: Tearleads): void {
  tearleads.dispose();
  clearSessionForIdentityTransition(tearleads);
}
