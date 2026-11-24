import { afterEach, expect, mock, test } from "bun:test";
import {
  type ContainerNode,
  getRosterProfileDocumentLocalId,
  type OrganizationDirectory,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD,
  useOrgManagerProfileDisplayNames,
} from "./useOrgManagerProfileDisplayNames";
import {
  createTearleadsHarness,
  directory,
  ORGANIZATION_ID,
  PROFILE_DOCUMENT_ID,
  profileSummary,
  rosterUser,
  runtime,
  USER_ID,
} from "./useOrgManagerProfileDisplayNames.testUtils";

afterEach(() => cleanup());

const ROSTER_CONTAINER = {
  id: "roster-profile-container",
} as ContainerNode;

function rosterUsers(count: number) {
  return Array.from({ length: count }, (_, index) =>
    rosterUser({
      profileDocumentId: `profile-document-${index}`,
      userId: `profile-user-${index}`,
    }),
  );
}

/** The device's container listing, which may list the roster container late. */
function createContainerListing(initial: ContainerNode | null) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    find: mock(() => Promise.resolve(current)),
    list(container: ContainerNode) {
      current = container;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
    subscribe: mock((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
}

function renderDisplayNames(input: {
  readonly activeDirectory: OrganizationDirectory;
  readonly containers?: ReturnType<typeof createContainerListing>;
  readonly harness: ReturnType<typeof createTearleadsHarness>;
}) {
  const containers =
    input.containers ?? createContainerListing(ROSTER_CONTAINER);
  const findRosterProfileContainer = containers.find;
  const appData = runtime();
  const selectedUserIdRef = { current: null };
  const view = renderHook(
    (activeDirectory: OrganizationDirectory) =>
      useOrgManagerProfileDisplayNames({
        appData,
        canLoadAuthenticatedOrgData: true,
        directory: activeDirectory,
        findRosterProfileContainer,
        selectedUserIdRef,
        subscribeToContainers: containers.subscribe,
        tearleads: input.harness.tearleads,
      }),
    { initialProps: input.activeDirectory },
  );
  return { containers, findRosterProfileContainer, view };
}

test("an admin's device pulls missing roster profiles, capped per load", async () => {
  const users = rosterUsers(MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD + 27);
  const harness = createTearleadsHarness();
  const { view } = renderDisplayNames({
    activeDirectory: directory(users),
    harness,
  });

  await waitFor(() =>
    expect(harness.requestRemoteSyncAndWait).toHaveBeenCalledTimes(
      MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD,
    ),
  );
  expect(harness.open).toHaveBeenCalledTimes(
    MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD,
  );
  expect(harness.open.mock.calls[0]).toEqual([
    {
      containerId: ROSTER_CONTAINER.id,
      documentId: "profile-document-0",
      localId: getRosterProfileDocumentLocalId({
        organizationId: ORGANIZATION_ID,
        userId: "profile-user-0",
      }),
    },
    { remoteSyncMode: "on-demand" },
  ]);
  expect(harness.requestSync).toHaveBeenCalledTimes(0);

  // A pulled profile repaints its row through the documents subscription.
  act(() => {
    harness.emit(
      profileSummary({
        profileDocumentId: "profile-document-0",
        title: "Rosa Reyes",
        userId: "profile-user-0",
      }),
    );
  });
  await waitFor(() =>
    expect(
      view.result.current.profileDisplayNamesByUserId.get("profile-user-0"),
    ).toBe("Rosa Reyes"),
  );
  // Reloads after a pull never start a second pass in the same load.
  expect(harness.open).toHaveBeenCalledTimes(
    MAX_ROSTER_PROFILE_HYDRATIONS_PER_LOAD,
  );
});

test("profiles this device already holds are never pulled", async () => {
  const user = rosterUser({
    profileDocumentId: PROFILE_DOCUMENT_ID,
    userId: USER_ID,
  });
  const harness = createTearleadsHarness([
    profileSummary({
      profileDocumentId: PROFILE_DOCUMENT_ID,
      title: "Local Name",
      userId: USER_ID,
    }),
  ]);
  const { findRosterProfileContainer, view } = renderDisplayNames({
    activeDirectory: directory([user]),
    harness,
  });

  await waitFor(() =>
    expect(view.result.current.profileDisplayNamesByUserId.get(USER_ID)).toBe(
      "Local Name",
    ),
  );
  expect(findRosterProfileContainer).toHaveBeenCalledTimes(0);
  expect(harness.open).toHaveBeenCalledTimes(0);
});

test("a device that lists the roster container late still pulls", async () => {
  const harness = createTearleadsHarness();
  const containers = createContainerListing(null);
  renderDisplayNames({
    activeDirectory: directory(rosterUsers(2)),
    containers,
    harness,
  });

  await waitFor(() => expect(containers.find).toHaveBeenCalledTimes(1));
  await act(async () => Promise.resolve());
  expect(harness.open).toHaveBeenCalledTimes(0);

  act(() => containers.list(ROSTER_CONTAINER));
  await waitFor(() =>
    expect(harness.requestRemoteSyncAndWait).toHaveBeenCalledTimes(2),
  );
  expect(harness.open.mock.calls[0]?.[0]).toMatchObject({
    containerId: ROSTER_CONTAINER.id,
  });
  // Later listing changes never start a second pass in the same load.
  act(() => containers.list(ROSTER_CONTAINER));
  await act(async () => Promise.resolve());
  expect(harness.open).toHaveBeenCalledTimes(2);
});

test("a profile that fails to pull does not stop the others", async () => {
  const harness = createTearleadsHarness();
  harness.requestRemoteSyncAndWait.mockImplementationOnce(() =>
    Promise.reject(new Error("offline")),
  );
  renderDisplayNames({ activeDirectory: directory(rosterUsers(3)), harness });

  await waitFor(() =>
    expect(harness.requestRemoteSyncAndWait).toHaveBeenCalledTimes(3),
  );
  expect(harness.logError).toHaveBeenCalledTimes(1);
});

test("a member who is not an admin pulls no roster profiles", async () => {
  const harness = createTearleadsHarness();
  const { containers, findRosterProfileContainer } = renderDisplayNames({
    activeDirectory: directory(rosterUsers(3), ORGANIZATION_ID, false),
    harness,
  });

  await waitFor(() => expect(harness.list).toHaveBeenCalledTimes(1));
  await act(async () => Promise.resolve());
  expect(findRosterProfileContainer).toHaveBeenCalledTimes(0);
  expect(containers.subscribe).toHaveBeenCalledTimes(0);
  expect(harness.open).toHaveBeenCalledTimes(0);
});

test("unmounting cancels the pass between pulls", async () => {
  const harness = createTearleadsHarness();
  let finishFirstPull: (completed: boolean) => void = () => undefined;
  harness.requestRemoteSyncAndWait.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishFirstPull = resolve;
      }),
  );
  const { containers, view } = renderDisplayNames({
    activeDirectory: directory(rosterUsers(3)),
    harness,
  });

  await waitFor(() =>
    expect(harness.requestRemoteSyncAndWait).toHaveBeenCalledTimes(1),
  );
  const [signal] = harness.requestRemoteSyncAndWait.mock.calls[0] ?? [];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(containers.listenerCount()).toBe(0);

  await act(async () => finishFirstPull(false));
  expect(harness.open).toHaveBeenCalledTimes(1);
});
