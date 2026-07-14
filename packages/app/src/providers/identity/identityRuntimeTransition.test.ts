import { expect, test } from "bun:test";
import { Tearleads } from "@tearleads/client-sdk";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";

test("identity transition clears the full session and prior server events", () => {
  const tearleads = new Tearleads();
  tearleads.session.setContext({
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-org-a",
    isAuthenticated: true,
    organizationId: "org-a",
    userId: "user-a",
  });
  tearleads.events.push({ id: "event-a" });

  prepareForIdentityTransition(tearleads);

  expect(tearleads.session.snapshot).toEqual({
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    organizationId: null,
    userId: null,
  });
  expect(tearleads.events.events).toEqual([]);
});
