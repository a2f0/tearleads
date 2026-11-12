import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { UnverifiedUserIdentityError } from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as identityLinks from "../../../providers/identity-links/useIdentityLinks";
import { useOrgManagerMembershipMutations } from "./useOrgManagerMembershipMutations";

type Params = Parameters<typeof useOrgManagerMembershipMutations>[0];

afterEach(() => {
  cleanup();
  mock.restore();
});

test("an active directory selection reaches SDK admission and displays its refusal without clearing the selection", async () => {
  const resolveVerified = mock(async () => null);
  const verifyLink = mock(async () => {
    throw new Error("A directory selection is not an identity link");
  });
  spyOn(identityLinks, "useIdentityLinks").mockReturnValue({
    createLink: async () => "unused",
    createLinkFor: async () => null,
    linkFromToken: (token) => token,
    resolveVerified,
    verifyLink,
  });
  const refusal = new UnverifiedUserIdentityError("bob");
  const addUserToGroup = mock(async () => {
    throw refusal;
  });
  const setError = mock(() => {});
  const setAddUserId = mock(() => {});
  const refreshDirectoryAndGroups = mock(async () => ({
    didLoad: false as const,
    groupId: null,
  }));
  const view = renderHook(() =>
    useOrgManagerMembershipMutations({
      addUserId: "bob",
      appData: {
        auth: { organizationId: "org-a", userId: "alice" },
        crypto: {
          signingFingerprint: "alice-signing",
          signingKeyPair: generateSigningSeedAndKeyPair(),
          encapsulationKeyPair: generateKemSeedAndKeyPair(),
        },
      } as unknown as Params["appData"],
      directory: {
        currentUser: { isOrgAdmin: true },
        organizationId: "org-a",
        profileDocumentId: null,
        users: [
          {
            userId: "bob",
            status: "active",
            // Selection data, deliberately not cryptographic evidence.
            signingPublicKey: "untrusted-directory-signing-key",
            encapsulationPublicKey: "untrusted-directory-encryption-key",
          } as NonNullable<Params["directory"]>["users"][number],
        ],
      },
      invalidateSelectedGroupDetails: () => {},
      isOperationActive: () => true,
      logError: () => {},
      memberGroupId: "members",
      members: { groupId: "team", organizationId: "org-a", members: [] },
      orgManagerActions: {
        addUserToGroup,
      } as unknown as Params["orgManagerActions"],
      refreshDirectoryAndGroups,
      refreshSelectedGroupDetails: async () => {},
      selectedGroupId: "team",
      selectedGroupName: "Team",
      selectedGroupIsAdminsGroup: false,
      selectedGroupIsMembersGroup: false,
      setAddUserId,
      setError,
      setMutating: () => {},
    }),
  );

  await act(async () => {
    await view.result.current.addUser();
  });
  expect(addUserToGroup).toHaveBeenCalledWith("team", "bob", "Team");
  expect(resolveVerified).not.toHaveBeenCalled();
  expect(verifyLink).not.toHaveBeenCalled();
  expect(setError).toHaveBeenLastCalledWith(refusal.message);
  expect(setAddUserId).not.toHaveBeenCalled();
  expect(refreshDirectoryAndGroups).not.toHaveBeenCalled();
});
