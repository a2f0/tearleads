import { expect, test } from "bun:test";
import { SymCrypt } from "@symcrypt/client-sdk";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";

test("identity transition clears the full session and prior server events", () => {
  const symcrypt = new SymCrypt();
  symcrypt.session.setContext({
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-org-a",
    isAuthenticated: true,
    organizationId: "org-a",
    userId: "user-a",
  });
  symcrypt.events.push({ id: "event-a" });

  prepareForIdentityTransition(symcrypt);

  expect(symcrypt.session.snapshot).toEqual({
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  });
  expect(symcrypt.events.events).toEqual([]);
});
