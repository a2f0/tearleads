import type { SymCrypt } from "@symcrypt/client-sdk";

/** Detach auth and events before publishing a different signing identity. */
function clearSessionForIdentityTransition(symcrypt: SymCrypt): void {
  symcrypt.events.clear();
  symcrypt.session.setContext({
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  });
}

/** Stop identity-scoped work and detach the old session before changing keys. */
export function prepareForIdentityTransition(symcrypt: SymCrypt): void {
  symcrypt.dispose();
  clearSessionForIdentityTransition(symcrypt);
}
