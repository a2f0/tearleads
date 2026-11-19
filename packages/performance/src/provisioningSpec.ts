import type { ProvisionedSystemContainerSpec } from "@tearleads/client-sdk";

// Same public host input as the app, guarded by sdkHost.test.ts. Contacts are
// created after login by the app and outside this registration scenario.
export const provisioningSpec: ProvisionedSystemContainerSpec[] = [
  {
    name: "Trash",
    icon: "trash",
    slotNamespace: "tearleads.organization-trash",
  },
];
