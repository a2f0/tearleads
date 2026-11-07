import { afterEach, expect, test } from "bun:test";
import {
  type ContainerInfo,
  type ContainerShareAccessLevel,
  type OrganizationDirectoryAndGroups,
  type OrganizationDirectoryUser,
  UnverifiedUserIdentityError,
} from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { ExplorerContainerInfoPanel } from "./ExplorerContainerInfoPanel";

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

function renderPanel(shareWithUser: ShareWithUser) {
  return render(
    createElement(ExplorerContainerInfoPanel, {
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
      readModelProjection: READ_MODEL,
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
    }),
  );
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
  // Bob is preselected; picking Carol exercises the choice.
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

// The SDK admits only a recipient whose identity link was verified here, so
// its refusal tells the user what to do instead of a generic failure.
test("an unverified recipient asks for their identity link", async () => {
  const view = renderPanel(async (_containerId, userId) => {
    throw new UnverifiedUserIdentityError(userId);
  });
  await openUserShare(view);
  fireEvent.click(view.getByRole("button", { name: "Share" }));

  await waitFor(() => {
    expect(
      view.getByText(
        "Verify this person's identity link before sharing with them.",
      ),
    ).toBeTruthy();
  });
});
