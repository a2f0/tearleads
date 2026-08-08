import { afterEach, expect, mock, test } from "bun:test";
import {
  createDomainScope,
  type DomainScope,
  type LocalOrganizationSummary,
  type SessionContext,
  type SessionCreateOrganizationResult,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { useOrgSwitcherController } from "./useOrgSwitcherController";

afterEach(() => cleanup());

const ORGANIZATION_A: LocalOrganizationSummary = {
  name: "Acme",
  organizationId: "org-a",
  rootContainerId: "container-a",
};
const ORGANIZATION_B: LocalOrganizationSummary = {
  name: "Beta",
  organizationId: "org-b",
  rootContainerId: "container-b",
};
const CREATED_ORGANIZATION: SessionCreateOrganizationResult = {
  containerId: ORGANIZATION_B.rootContainerId,
  organizationId: ORGANIZATION_B.organizationId,
};
const DOMAIN_SCOPE = createDomainScope();

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function renderSwitcher(input: {
  activeOrganizationId?: string | null | undefined;
  databaseReady: boolean;
  interactionDisabled?: boolean | undefined;
  listLocalOrganizations: () => Promise<LocalOrganizationSummary[]>;
  provisionOrganization?: (
    organizationProfileName: string,
  ) => Promise<SessionCreateOrganizationResult | null>;
  setSessionContext?: (context: SessionContext) => void;
}) {
  const provisionOrganization =
    input.provisionOrganization ?? mock(async () => null);
  const setSessionContext = input.setSessionContext ?? mock(() => {});
  return renderHook(
    (props: {
      databaseReady: boolean;
      interactionDisabled: boolean;
      scopeKey: DomainScope;
    }) =>
      useOrgSwitcherController({
        activeContainerId:
          input.activeOrganizationId === null
            ? null
            : ORGANIZATION_A.rootContainerId,
        activeOrganizationId:
          input.activeOrganizationId === undefined
            ? ORGANIZATION_A.organizationId
            : input.activeOrganizationId,
        databaseReady: props.databaseReady,
        enabled: true,
        interactionDisabled: props.interactionDisabled,
        listLocalOrganizations: input.listLocalOrganizations,
        organizationIndexRefreshKey: "organization-index-a",
        operationScopeKey: "session-a",
        provisionOrganization,
        scopeKey: props.scopeKey,
        setSessionContext,
      }),
    {
      initialProps: {
        databaseReady: input.databaseReady,
        interactionDisabled: input.interactionDisabled ?? false,
        scopeKey: DOMAIN_SCOPE,
      },
    },
  );
}

test("waits for SQLite readiness before listing organizations", async () => {
  const listLocalOrganizations = mock(async () => [ORGANIZATION_A]);
  const view = renderSwitcher({
    databaseReady: false,
    listLocalOrganizations,
  });

  expect(listLocalOrganizations).toHaveBeenCalledTimes(0);
  expect(view.result.current.organizations).toEqual([
    { ...ORGANIZATION_A, name: null },
  ]);
  expect(view.result.current.organizationsLoading).toBe(true);
  expect(view.result.current.interactionDisabled).toBe(true);

  view.rerender({
    databaseReady: true,
    interactionDisabled: false,
    scopeKey: DOMAIN_SCOPE,
  });

  await waitFor(() => {
    expect(listLocalOrganizations).toHaveBeenCalledTimes(1);
    expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
    expect(view.result.current.organizationsLoading).toBe(false);
  });
});

test("retries while the active organization index catches up", async () => {
  let attempt = 0;
  const listLocalOrganizations = mock(async () => {
    attempt += 1;
    return attempt === 1 ? [] : [ORGANIZATION_A];
  });
  const view = renderSwitcher({
    databaseReady: true,
    listLocalOrganizations,
  });

  expect(view.result.current.organizations).toEqual([
    { ...ORGANIZATION_A, name: null },
  ]);
  await waitFor(
    () => {
      expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
      expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
    },
    { timeout: 1_500 },
  );
});

test("keeps the prior organization list when a retry fails", async () => {
  let shouldFail = false;
  const listLocalOrganizations = mock(async () => {
    if (shouldFail) {
      throw new Error("transient list failure");
    }
    return [ORGANIZATION_A];
  });
  const view = renderSwitcher({ databaseReady: true, listLocalOrganizations });

  await waitFor(() => {
    expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
  });

  shouldFail = true;
  view.rerender({
    databaseReady: false,
    interactionDisabled: false,
    scopeKey: DOMAIN_SCOPE,
  });
  expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
  view.rerender({
    databaseReady: true,
    interactionDisabled: false,
    scopeKey: DOMAIN_SCOPE,
  });

  await waitFor(() => {
    expect(view.result.current.organizationsError).toBe(
      ORG_MANAGER_LABELS.failedLoadOrganizations,
    );
    expect(view.result.current.organizationsLoading).toBe(false);
  });
  expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
});

test("ignores a stale organization-list response", async () => {
  const first = deferred<LocalOrganizationSummary[]>();
  const second = deferred<LocalOrganizationSummary[]>();
  const responses = [first.promise, second.promise];
  const listLocalOrganizations = mock(() => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected organization-list request");
    }
    return response;
  });
  const view = renderSwitcher({ databaseReady: true, listLocalOrganizations });

  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(1));
  view.rerender({
    databaseReady: false,
    interactionDisabled: false,
    scopeKey: DOMAIN_SCOPE,
  });
  view.rerender({
    databaseReady: true,
    interactionDisabled: false,
    scopeKey: DOMAIN_SCOPE,
  });
  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(2));

  await act(async () => {
    second.resolve([ORGANIZATION_B]);
    await second.promise;
  });
  const organizationsWithActiveFallback = [
    ORGANIZATION_B,
    { ...ORGANIZATION_A, name: null },
  ];
  expect(view.result.current.organizations).toEqual(
    organizationsWithActiveFallback,
  );

  await act(async () => {
    first.resolve([ORGANIZATION_A]);
    await first.promise;
  });
  expect(view.result.current.organizations).toEqual(
    organizationsWithActiveFallback,
  );
});

test("drops an organization-list response from a previous database scope", async () => {
  const oldScopeResponse = deferred<LocalOrganizationSummary[]>();
  const newScopeResponse = deferred<LocalOrganizationSummary[]>();
  const responses = [oldScopeResponse.promise, newScopeResponse.promise];
  const listLocalOrganizations = mock(() => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected organization-list request");
    }
    return response;
  });
  const view = renderSwitcher({ databaseReady: true, listLocalOrganizations });
  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(1));

  view.rerender({
    databaseReady: true,
    interactionDisabled: false,
    scopeKey: createDomainScope(),
  });
  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(2));

  await act(async () => {
    oldScopeResponse.resolve([ORGANIZATION_B]);
    await oldScopeResponse.promise;
  });
  expect(view.result.current.organizations).toEqual([
    { ...ORGANIZATION_A, name: null },
  ]);

  await act(async () => {
    newScopeResponse.resolve([ORGANIZATION_A]);
    await newScopeResponse.promise;
  });
  expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
});

test("keeps the create dialog open when provisioning returns null", async () => {
  const provisionOrganization = mock(async () => null);
  const setSessionContext = mock((_context: SessionContext) => {});
  const view = renderSwitcher({
    databaseReady: true,
    listLocalOrganizations: mock(async () => [ORGANIZATION_A]),
    provisionOrganization,
    setSessionContext,
  });
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  act(() => view.result.current.openCreateOrganizationDialog());
  await act(async () => {
    await view.result.current.createOrganization("Beta");
  });

  expect(provisionOrganization).toHaveBeenCalledTimes(1);
  expect(setSessionContext).toHaveBeenCalledTimes(0);
  expect(view.result.current.createOrganizationError).toBe(
    ORG_MANAGER_LABELS.failedCreateOrganization,
  );
  expect(view.result.current.isCreateOrganizationDialogOpen).toBe(true);
});

test("selects and retains a created organization when list reconciliation fails", async () => {
  let listAttempt = 0;
  const listLocalOrganizations = mock(async () => {
    listAttempt += 1;
    if (listAttempt > 1) {
      throw new Error("reconciliation failed");
    }
    return [ORGANIZATION_A];
  });
  const provisionOrganization = mock(async () => CREATED_ORGANIZATION);
  const setSessionContext = mock((_context: SessionContext) => {});
  const view = renderSwitcher({
    databaseReady: true,
    listLocalOrganizations,
    provisionOrganization,
    setSessionContext,
  });
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  act(() => view.result.current.openCreateOrganizationDialog());
  await act(async () => {
    await view.result.current.createOrganization("  Beta  ");
  });

  expect(setSessionContext).toHaveBeenCalledWith({
    containerId: ORGANIZATION_B.rootContainerId,
    organizationId: ORGANIZATION_B.organizationId,
  });
  expect(view.result.current.organizations).toEqual([
    ORGANIZATION_A,
    ORGANIZATION_B,
  ]);
  expect(view.result.current.organizationsError).toBe(
    ORG_MANAGER_LABELS.failedLoadOrganizations,
  );
  expect(view.result.current.createOrganizationError).toBeNull();
  expect(view.result.current.isCreateOrganizationDialogOpen).toBe(false);
});

test("retains a created organization until the local index observes it", async () => {
  const listLocalOrganizations = mock(async () => [ORGANIZATION_A]);
  const view = renderSwitcher({
    databaseReady: true,
    listLocalOrganizations,
    provisionOrganization: mock(async () => CREATED_ORGANIZATION),
  });
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  await act(async () => {
    await view.result.current.createOrganization("Beta");
  });

  expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
  expect(view.result.current.organizations).toEqual([
    ORGANIZATION_A,
    ORGANIZATION_B,
  ]);
  expect(view.result.current.organizationsError).toBeNull();
});

test("guards duplicate create submissions", async () => {
  const provisioned = deferred<SessionCreateOrganizationResult | null>();
  const provisionOrganization = mock(() => provisioned.promise);
  const view = renderSwitcher({
    databaseReady: true,
    listLocalOrganizations: mock(async () => [ORGANIZATION_A, ORGANIZATION_B]),
    provisionOrganization,
  });
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  let firstCreate: Promise<void> | undefined;
  let duplicateCreate: Promise<void> | undefined;
  act(() => {
    firstCreate = view.result.current.createOrganization("Beta");
    duplicateCreate = view.result.current.createOrganization("Beta");
  });
  await duplicateCreate;
  expect(provisionOrganization).toHaveBeenCalledTimes(1);

  await act(async () => {
    provisioned.resolve(CREATED_ORGANIZATION);
    await firstCreate;
  });
});

test("blocks organization selection while creation is pending", async () => {
  const provisioned = deferred<SessionCreateOrganizationResult | null>();
  const setSessionContext = mock((_context: SessionContext) => {});
  const view = renderSwitcher({
    databaseReady: true,
    listLocalOrganizations: mock(async () => [ORGANIZATION_A, ORGANIZATION_B]),
    provisionOrganization: mock(() => provisioned.promise),
    setSessionContext,
  });
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  let create: Promise<void> | undefined;
  act(() => {
    create = view.result.current.createOrganization("Beta");
  });
  await waitFor(() => {
    expect(view.result.current.creating).toBe(true);
    expect(view.result.current.interactionDisabled).toBe(true);
  });

  act(() =>
    view.result.current.selectOrganization(ORGANIZATION_B.organizationId),
  );
  expect(setSessionContext).toHaveBeenCalledTimes(0);

  await act(async () => {
    provisioned.resolve(CREATED_ORGANIZATION);
    await create;
  });
  expect(setSessionContext).toHaveBeenCalledTimes(1);
});

test("blocks create and selection while interaction is unavailable", async () => {
  const provisionOrganization = mock(async () => CREATED_ORGANIZATION);
  const setSessionContext = mock((_context: SessionContext) => {});
  const listLocalOrganizations = mock(async () => [
    ORGANIZATION_A,
    ORGANIZATION_B,
  ]);
  const view = renderSwitcher({
    databaseReady: false,
    listLocalOrganizations,
    provisionOrganization,
    setSessionContext,
  });

  act(() => {
    view.result.current.openCreateOrganizationDialog();
    view.result.current.selectOrganization(ORGANIZATION_B.organizationId);
  });
  await act(async () => {
    await view.result.current.createOrganization("Beta");
  });
  expect(listLocalOrganizations).toHaveBeenCalledTimes(0);
  expect(provisionOrganization).toHaveBeenCalledTimes(0);
  expect(setSessionContext).toHaveBeenCalledTimes(0);
  expect(view.result.current.isCreateOrganizationDialogOpen).toBe(false);

  view.rerender({
    databaseReady: true,
    interactionDisabled: true,
    scopeKey: DOMAIN_SCOPE,
  });
  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(1));
  act(() => {
    view.result.current.openCreateOrganizationDialog();
    view.result.current.selectOrganization(ORGANIZATION_B.organizationId);
  });
  await act(async () => {
    await view.result.current.createOrganization("Beta");
  });
  expect(provisionOrganization).toHaveBeenCalledTimes(0);
  expect(setSessionContext).toHaveBeenCalledTimes(0);
  expect(view.result.current.isCreateOrganizationDialogOpen).toBe(false);
});

test("allows an authenticated session with no active org to recover by selecting one", async () => {
  const setSessionContext = mock((_context: SessionContext) => {});
  const view = renderSwitcher({
    activeOrganizationId: null,
    databaseReady: true,
    listLocalOrganizations: mock(async () => [ORGANIZATION_A]),
    setSessionContext,
  });
  await waitFor(() =>
    expect(view.result.current.organizationsLoading).toBe(false),
  );

  act(() =>
    view.result.current.selectOrganization(ORGANIZATION_A.organizationId),
  );

  expect(setSessionContext).toHaveBeenCalledWith({
    containerId: ORGANIZATION_A.rootContainerId,
    organizationId: ORGANIZATION_A.organizationId,
  });
});
