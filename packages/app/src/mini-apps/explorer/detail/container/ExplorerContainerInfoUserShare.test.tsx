import { afterEach, expect, test } from "bun:test";
import {
  type ContainerInfo,
  type ContainerShareAccessLevel,
  type OrganizationDirectoryAndGroups,
  type OrganizationDirectoryUser,
  UnverifiedUserIdentityError,
} from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";
import { useExplorerContainerInfoUserShare } from "./ExplorerContainerInfoState";

afterEach(() => cleanup());

const PROFILE_NAMES: Record<string, string> = {
  "user-bob": "Bob",
  "user-carol": "Carol",
  "user-erin": "Erin",
  "user-self": "Me",
};

function rosterUser(
  userId: string,
  overrides: Partial<OrganizationDirectoryUser> = {},
): OrganizationDirectoryUser {
  return {
    createdAt: "2026-05-20T12:00:00.000Z",
    disabledAt: null,
    disabledByUserId: null,
    encapsulationKeyFingerprint: `${userId}-encapsulation`,
    encapsulationPublicKey: `${userId}-encapsulation-key`,
    isPersonalOrganizationOwner: false,
    isSelf: false,
    joinedAt: "2026-05-20T12:00:00.000Z",
    leaveRequest: null,
    profileDocumentId: null,
    signingKeyFingerprint: `${userId}-signing`,
    signingPublicKey: `${userId}-signing-key`,
    status: "active",
    updatedAt: "2026-05-20T12:00:00.000Z",
    userId,
    ...overrides,
  };
}

// Erin already holds a direct grant; the viewer and a disabled member are
// never share targets either.
const READ_MODEL: OrganizationDirectoryAndGroups = {
  directory: {
    currentUser: { isOrgAdmin: true },
    organizationId: "org-1",
    profileDocumentId: null,
    users: [
      rosterUser("user-self", { isSelf: true }),
      rosterUser("user-bob"),
      rosterUser("user-carol"),
      rosterUser("user-dave", {
        disabledAt: "2026-05-24T12:00:00.000Z",
        status: "disabled",
      }),
      rosterUser("user-erin"),
    ],
  },
  groups: [],
  memberGroupId: "group-members",
  readModelCursor: "cursor-1",
};

function containerInfo(): ContainerInfo {
  const erinGrant = {
    accessLevel: "read",
    subjectId: "user-erin",
    subjectType: "user",
  } as const;
  return {
    local: { createdAt: null, updatedAt: null },
    remoteInfo: {
      grantRows: [
        { ...erinGrant, inherited: false, sourceContainerId: "container-1" },
      ],
      grants: [erinGrant],
      groups: [],
      syncCursors: [],
    },
  };
}

type ShareWithUser = (
  containerId: string,
  userId: string,
  accessLevel: ContainerShareAccessLevel,
) => Promise<boolean>;

function panelElement(
  shareWithUser: ShareWithUser,
  readModel: OrganizationDirectoryAndGroups = READ_MODEL,
) {
  return createElement(ExplorerContainerInfoPanel, {
    canManageIcon: false,
    canShareContainer: true,
    canShareWithPeer: false,
    containerIcon: null,
    containerId: "container-1",
    containerName: "Documents",
    containerNamesById: new Map([["container-1", "Documents"]]),
    containerSyncStatus: "synced",
    loadContainerInfo: async () => containerInfo(),
    logError: () => undefined,
    onOpenGrant: () => undefined,
    peerUserId: null,
    readModelProjection: readModel,
    resolveUserLabel: (userId) =>
      userId ? (PROFILE_NAMES[userId] ?? null) : null,
    setContainerIcon: async () => null,
    shareScope: {
      domainScope: {},
      organizationId: "org-1",
      signingFingerprint: "fingerprint-1",
      userId: "user-self",
    },
    shareWithGroup: async () => true,
    shareWithUser,
  });
}

function renderPanel(shareWithUser: ShareWithUser) {
  return render(panelElement(shareWithUser));
}

function openMenuOptions(view: ReturnType<typeof render>, name: string) {
  fireEvent.click(view.getByRole("combobox", { name }));
  return Array.from(document.body.querySelectorAll('[role="option"]')).filter(
    (option): option is HTMLElement => option instanceof HTMLElement,
  );
}

function pickOption(
  view: ReturnType<typeof render>,
  name: string,
  label: string,
) {
  const option = openMenuOptions(view, name).find(
    (candidate) =>
      candidate.querySelector(".mini-app-select-menu-label")?.textContent ===
      label,
  );
  if (!option) {
    throw new Error(`Expected the ${label} option in ${name}.`);
  }
  fireEvent.click(option);
}

async function openUserShare(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(view.getByText("Local Details")).toBeTruthy();
  });
  fireEvent.click(view.getByRole("tab", { name: "Sharing" }));
  pickOption(view, "Share with", "User");
}

test("a direct user share sends the chosen roster user and permission", async () => {
  const shareCalls: Array<[string, string, ContainerShareAccessLevel]> = [];
  const view = renderPanel(async (containerId, userId, accessLevel) => {
    shareCalls.push([containerId, userId, accessLevel]);
    return true;
  });
  await openUserShare(view);

  const userOptions = openMenuOptions(view, "User");
  expect(
    userOptions.map(
      (option) =>
        option.querySelector(".mini-app-select-menu-label")?.textContent,
    ),
  ).toEqual(["Bob", "Carol"]);
  // No user is preselected: Share waits for an explicit pick.
  expect(
    view.getByRole("button", { name: "Share" }).hasAttribute("disabled"),
  ).toBe(true);
  const carol = userOptions[1];
  if (!carol) {
    throw new Error("Expected the Carol option.");
  }
  fireEvent.click(carol);
  pickOption(view, "Permission", "read");
  fireEvent.click(view.getByRole("button", { name: "Share" }));

  await waitFor(() => {
    expect(shareCalls).toEqual([["container-1", "user-carol", "read"]]);
  });
  const grants = view
    .getByRole("heading", { name: "Principal Grants" })
    .closest("section");
  if (!(grants instanceof HTMLElement)) {
    throw new Error("Expected the grants section.");
  }
  await waitFor(() => {
    expect(within(grants).getByText("Carol")).toBeTruthy();
  });
  expect(within(grants).getByText("Erin")).toBeTruthy();
});

// Without a verified link, write or admin access is refused outright, and read
// access only when the signed roster does not vouch for the recipient; each
// refusal names its own fix instead of a generic failure.
test("an unverified recipient's refusal names the fix for the chosen access", async () => {
  const view = renderPanel(async (_containerId, userId) => {
    throw new UnverifiedUserIdentityError(userId);
  });
  await openUserShare(view);
  pickOption(view, "User", "Bob");
  fireEvent.click(view.getByRole("button", { name: "Share" }));

  await waitFor(() => {
    expect(
      view.getByText(
        "Verify this person's identity link to give them write or admin access. Without it you can share read-only.",
      ),
    ).toBeTruthy();
  });

  pickOption(view, "Permission", "read");
  fireEvent.click(view.getByRole("button", { name: "Share" }));
  await waitFor(() => {
    expect(
      view.getByText(
        "Verify this person's identity link before sharing with them.",
      ),
    ).toBeTruthy();
  });
});

// A roster refresh can drop the chosen person (disabled here). The pick must
// clear rather than move to another member, so Share cannot reach the wrong
// person.
test("a chosen user who leaves the roster clears the pick", async () => {
  const shareCalls: string[] = [];
  const shareWithUser: ShareWithUser = async (_containerId, userId) => {
    shareCalls.push(userId);
    return true;
  };
  const view = renderPanel(shareWithUser);
  await openUserShare(view);
  pickOption(view, "User", "Bob");

  view.rerender(
    panelElement(shareWithUser, {
      ...READ_MODEL,
      directory: {
        ...READ_MODEL.directory,
        users: READ_MODEL.directory.users.map((user) =>
          user.userId === "user-bob"
            ? {
                ...user,
                disabledAt: "2026-05-25T12:00:00.000Z",
                status: "disabled",
              }
            : user,
        ),
      },
    }),
  );

  await waitFor(() => {
    expect(view.getByRole("combobox", { name: "User" }).textContent).toBe(
      "Choose a user",
    );
  });
  const share = view.getByRole("button", { name: "Share" });
  expect(share.hasAttribute("disabled")).toBe(true);
  fireEvent.click(share);
  expect(shareCalls).toEqual([]);
});

// A share outlives a switch to another folder. Its reload and its failure
// belong to the folder it started in, so neither may land on the one shown.
test("a share settling after a folder switch leaves the new folder alone", async () => {
  const outcomes = [
    (pending: PromiseWithResolvers<boolean>) => pending.resolve(true),
    (pending: PromiseWithResolvers<boolean>) => pending.resolve(false),
    (pending: PromiseWithResolvers<boolean>) =>
      pending.reject(new Error("share failed")),
  ];
  for (const settle of outcomes) {
    const pending = Promise.withResolvers<boolean>();
    let shareStarted = false;
    const reloads: unknown[] = [];
    const panelErrors: Array<string | null> = [];
    const view = renderHook(
      (props: { containerId: string }) =>
        useExplorerContainerInfoUserShare({
          canShareContainer: true,
          containerId: props.containerId,
          isSubmitting: false,
          logError: () => undefined,
          reloadContainerInfo: async (options) => {
            reloads.push(options);
          },
          setIsSubmitting: () => undefined,
          setPanelError: (error) => {
            panelErrors.push(error);
          },
          shareScope: {
            domainScope: {},
            organizationId: "org-1",
            signingFingerprint: "fingerprint-1",
            userId: "user-self",
          },
          shareWithUser: () => {
            shareStarted = true;
            return pending.promise;
          },
        }),
      { initialProps: { containerId: "container-1" } },
    );

    let submitted: Promise<void> | undefined;
    act(() => {
      submitted = view.result.current({
        accessLevel: "write",
        failureLabel: "Failed to share container with user.",
        userId: "user-bob",
      });
    });
    await waitFor(() => {
      expect(shareStarted).toBe(true);
    });
    view.rerender({ containerId: "container-2" });
    await act(async () => {
      settle(pending);
      await submitted;
    });

    expect(reloads).toEqual([]);
    // Only the clear from the share's own start.
    expect(panelErrors).toEqual([null]);
    view.unmount();
  }
});
