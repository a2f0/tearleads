import { afterEach, expect, test } from "bun:test";
import { createDomainScope } from "@symcrypt/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBlobOrganizationNames } from "./useBlobOrganizationNames";

afterEach(cleanup);

test("resolves every named local organization for the shared blob browser", async () => {
  const scope = createDomainScope();
  const listLocalOrganizations = async () => [
    {
      name: "Personal",
      organizationId: "org-personal",
      rootContainerId: "root-personal",
    },
    {
      name: "Custom Org",
      organizationId: "org-custom",
      rootContainerId: "root-custom",
    },
    {
      name: null,
      organizationId: "org-pending",
      rootContainerId: "root-pending",
    },
  ];
  const { result } = renderHook(() =>
    useBlobOrganizationNames({
      listLocalOrganizations,
      ready: true,
      scope,
    }),
  );

  await waitFor(() => expect(result.current.size).toBe(2));
  expect(Object.fromEntries(result.current)).toEqual({
    "org-custom": "Custom Org",
    "org-personal": "Personal",
  });
});
