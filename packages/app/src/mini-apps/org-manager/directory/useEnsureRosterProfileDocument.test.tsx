import { afterEach, expect, mock, test } from "bun:test";
import type {
  DomainScope,
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useEnsureRosterProfileDocument } from "../hooks/useEnsureRosterProfileDocument";

type EnsureParams = Parameters<typeof useEnsureRosterProfileDocument>[0];

afterEach(() => cleanup());

const ROSTER_USER: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  profileDocumentId: null,
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: "roster-user",
};

const DIRECTORY: OrganizationDirectory = {
  currentUser: { isOrgAdmin: true },
  organizationId: "org-b",
  profileDocumentId: null,
  users: [ROSTER_USER],
};
const DOMAIN_SCOPE = {} as DomainScope;

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function runtimeForOrganization(
  organizationId: string,
): EnsureParams["appData"] {
  return {
    auth: { organizationId },
    state: { containerId: `container-${organizationId}` },
  } as EnsureParams["appData"];
}

function applyStateUpdate<T>(update: SetStateAction<T>, current: T): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

test("roster profile setup ignores an old organization result after switching", async () => {
  const orgAProfile = deferred<OrganizationDirectoryUser | null>();
  const orgBProfile = deferred<OrganizationDirectoryUser | null>();
  const pendingProfiles = [orgAProfile, orgBProfile];
  const ensureRosterProfileDocument = mock(() => {
    const pending = pendingProfiles.shift();
    if (!pending) {
      throw new Error("Unexpected profile setup request");
    }
    return pending.promise;
  });
  const directoryUpdates: Array<SetStateAction<OrganizationDirectory | null>> =
    [];
  const detailUpdates: Array<SetStateAction<OrganizationUserDetail | null>> =
    [];
  const setDirectory: Dispatch<SetStateAction<OrganizationDirectory | null>> = (
    update,
  ) => directoryUpdates.push(update);
  const setUserDetail: Dispatch<
    SetStateAction<OrganizationUserDetail | null>
  > = (update) => detailUpdates.push(update);
  const setError = mock((_update: SetStateAction<string | null>) => {});
  const setMutating = mock((_update: SetStateAction<boolean>) => {});
  const orgManagerActions = {
    ensureRosterProfileDocument,
  } as unknown as EnsureParams["orgManagerActions"];
  const selectedUserIdRef = { current: ROSTER_USER.userId };

  const view = renderHook(
    ({ organizationId }: { organizationId: string }) =>
      useEnsureRosterProfileDocument({
        appData: runtimeForOrganization(organizationId),
        canLoadAuthenticatedOrgData: true,
        canUpdateSelectedRosterEntry: true,
        domainScope: DOMAIN_SCOPE,
        orgManagerActions,
        scopeKey: organizationId,
        selectedRosterUser: ROSTER_USER,
        selectedUserIdRef,
        setDirectory,
        setError,
        setMutating,
        setUserDetail,
      }),
    { initialProps: { organizationId: "org-a" } },
  );

  await waitFor(() =>
    expect(ensureRosterProfileDocument).toHaveBeenCalledTimes(1),
  );
  view.rerender({ organizationId: "org-b" });
  await waitFor(() =>
    expect(ensureRosterProfileDocument).toHaveBeenCalledTimes(2),
  );

  await act(async () => {
    orgAProfile.resolve({
      ...ROSTER_USER,
      profileDocumentId: "org-a-profile-document",
    });
    await orgAProfile.promise;
  });
  expect(directoryUpdates).toEqual([]);
  expect(detailUpdates).toEqual([]);

  await act(async () => {
    orgBProfile.resolve({
      ...ROSTER_USER,
      profileDocumentId: "org-b-profile-document",
    });
    await orgBProfile.promise;
  });
  await waitFor(() => expect(directoryUpdates).toHaveLength(1));
  expect(detailUpdates).toHaveLength(1);

  const nextDirectory = applyStateUpdate(
    directoryUpdates[0] as SetStateAction<OrganizationDirectory | null>,
    DIRECTORY,
  );
  expect(nextDirectory?.users[0]?.profileDocumentId).toBe(
    "org-b-profile-document",
  );
  expect(setError).toHaveBeenCalledTimes(2);
  expect(setError).toHaveBeenNthCalledWith(1, null);
  expect(setError).toHaveBeenNthCalledWith(2, null);
  expect(setMutating).toHaveBeenLastCalledWith(false);
});

test("roster profile setup reuses pending work across a layout remount", async () => {
  const pendingProfile = deferred<OrganizationDirectoryUser | null>();
  const ensureRosterProfileDocument = mock(() => pendingProfile.promise);
  const orgManagerActions = {
    ensureRosterProfileDocument,
  } as unknown as EnsureParams["orgManagerActions"];
  const selectedUserIdRef = { current: ROSTER_USER.userId };
  const directoryUpdates: Array<SetStateAction<OrganizationDirectory | null>> =
    [];
  const common = {
    appData: runtimeForOrganization("org-a"),
    canLoadAuthenticatedOrgData: true,
    canUpdateSelectedRosterEntry: true,
    domainScope: DOMAIN_SCOPE,
    orgManagerActions,
    scopeKey: "org-a-ready",
    selectedRosterUser: ROSTER_USER,
    selectedUserIdRef,
    setError: mock((_update: SetStateAction<string | null>) => {}),
    setMutating: mock((_update: SetStateAction<boolean>) => {}),
    setUserDetail: mock(
      (_update: SetStateAction<OrganizationUserDetail | null>) => {},
    ),
  };

  const first = renderHook(() =>
    useEnsureRosterProfileDocument({
      ...common,
      setDirectory: mock(
        (_update: SetStateAction<OrganizationDirectory | null>) => {},
      ),
    }),
  );
  await waitFor(() =>
    expect(ensureRosterProfileDocument).toHaveBeenCalledTimes(1),
  );
  first.unmount();

  renderHook(() =>
    useEnsureRosterProfileDocument({
      ...common,
      setDirectory: (update) => directoryUpdates.push(update),
    }),
  );
  await act(async () => {
    pendingProfile.resolve({
      ...ROSTER_USER,
      profileDocumentId: "shared-profile-document",
    });
    await pendingProfile.promise;
  });

  await waitFor(() => expect(directoryUpdates).toHaveLength(1));
  expect(ensureRosterProfileDocument).toHaveBeenCalledTimes(1);
});
