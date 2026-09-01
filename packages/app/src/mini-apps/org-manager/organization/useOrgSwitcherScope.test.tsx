import { afterEach, expect, mock, test } from "bun:test";
import {
  createDomainScope,
  type LocalOrganizationSummary,
  type SessionContext,
  type SessionCreateOrganizationResult,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useOrgSwitcherController } from "./useOrgSwitcherController";

afterEach(() => cleanup());

const ORGANIZATION_A: LocalOrganizationSummary = {
  name: "Acme",
  organizationId: "org-a",
  rootContainerId: "container-a",
};
const ORGANIZATION_B: SessionCreateOrganizationResult = {
  containerId: "container-b",
  organizationId: "org-b",
};

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test("ignores organization creation after its session scope is invalidated", async () => {
  const provisioned = deferred<SessionCreateOrganizationResult | null>();
  const listLocalOrganizations = mock(async () => [ORGANIZATION_A]);
  const provisionOrganization = mock(() => provisioned.promise);
  const setSessionContext = mock((_context: SessionContext) => {});
  const scopeKey = createDomainScope();
  const view = renderHook(
    (props: { databaseReady: boolean; operationScopeKey: string }) =>
      useOrgSwitcherController({
        activeContainerId: ORGANIZATION_A.rootContainerId,
        activeOrganizationId: ORGANIZATION_A.organizationId,
        databaseReady: props.databaseReady,
        enabled: true,
        listLocalOrganizations,
        organizationIndexRefreshKey: "organization-index-a",
        operationScopeKey: props.operationScopeKey,
        provisionOrganization,
        scopeKey,
        setSessionContext,
      }),
    {
      initialProps: { databaseReady: true, operationScopeKey: "session-a" },
    },
  );
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  let creation: Promise<void> | undefined;
  act(() => {
    creation = view.result.current.createOrganization("Beta");
  });
  await waitFor(() => expect(view.result.current.creating).toBe(true));

  view.rerender({ databaseReady: false, operationScopeKey: "session-b" });
  await waitFor(() => expect(view.result.current.creating).toBe(false));
  await act(async () => {
    provisioned.resolve(ORGANIZATION_B);
    await creation;
  });

  expect(setSessionContext).toHaveBeenCalledTimes(0);
  expect(view.result.current.organizations).not.toContainEqual({
    name: "Beta",
    organizationId: ORGANIZATION_B.organizationId,
    rootContainerId: ORGANIZATION_B.containerId,
  });
});
