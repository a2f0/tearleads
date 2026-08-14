import { afterEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import invariant from "invariant";
import { waitForAppTestRuntimeToSettle } from "../../../../test/helpers/appRuntimeIdle";
import {
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
  getPaneRoot,
  getPaneUserId,
  interact,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
  renderDualPane,
  waitForDualPaneProvisioning,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import { importPeerIntoRoster } from "../../../../test/helpers/dual-pane/dualPaneRosterKit";
import {
  addPeerToAdminsGroup,
  createOrganizationGroup,
  openOrgManager,
} from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import { requestPath } from "../../../../test/helpers/dualPaneRequestSummary";
import { dropNextMswServerEventWhere } from "../../../../test/helpers/mswEventRouter";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

interface AuthenticatedSessionResponse {
  organizationId?: unknown;
  token?: unknown;
  userId?: unknown;
}

const PRE_MUTATION_NETWORK_QUIET_MS = 500;
const GROUP_MUTATION_TIMEOUT_MS = 10_000;

function readAuthenticatedSession(userId: string): {
  authorization: string;
  organizationId: string;
} {
  for (const request of listProxiedApiRequests()) {
    if (
      request.method !== "POST" ||
      requestPath(request.url) !== "/auth/verify" ||
      request.status !== 200
    ) {
      continue;
    }
    const response = JSON.parse(
      request.responseBody,
    ) as AuthenticatedSessionResponse;
    if (
      response.userId === userId &&
      typeof response.token === "string" &&
      typeof response.organizationId === "string"
    ) {
      return {
        authorization: `Bearer ${response.token}`,
        organizationId: response.organizationId,
      };
    }
  }

  throw new Error(`Authenticated session for ${userId} was not recorded.`);
}

function isContainerOrDocumentRequest(url: string): boolean {
  return /^\/(?:containers|documents)(?:\/|$)/u.test(requestPath(url));
}

async function switchMountedOrgManagerToForeignOrganization(input: {
  founderOrganizationId: string;
  pane: HTMLElement;
  peerAuthorization: string;
}) {
  await openOrgManager(input.pane);
  const organizationSelect = within(input.pane).getByRole("combobox", {
    name: "Organizations",
  });
  invariant(
    organizationSelect instanceof HTMLButtonElement,
    "Expected organization switcher.",
  );
  await interact(() => {
    fireEvent.click(organizationSelect);
  });
  const foreignOrganizationOption = await waitFor(() => {
    const options = within(input.pane).getAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(2);
    const option = options.find(
      (candidate) => candidate.getAttribute("aria-selected") === "false",
    );
    invariant(option, "Expected a foreign organization option.");
    return option;
  });

  const switchRequestStartIndex = listProxiedApiRequests().length;
  await interact(() => {
    fireEvent.click(foreignOrganizationOption);
  });
  await waitForCondition(
    () =>
      listProxiedApiRequests()
        .slice(switchRequestStartIndex)
        .some(
          (request) =>
            request.authorization === input.peerAuthorization &&
            request.method === "GET" &&
            requestPath(request.url) ===
              `/organizations/${input.founderOrganizationId}/read-model`,
        ),
    "Peer Org Manager did not load the founder organization read model.",
  );
  let settled = false;
  await act(async () => {
    settled = await waitForAppTestRuntimeToSettle({
      // Switching the active organization can start the 250ms provisioned
      // system-container pull. Require a quiet window spanning two ticks so
      // that bootstrap traffic cannot leak into the mutation budget.
      apiQuietMs: PRE_MUTATION_NETWORK_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    });
  });
  expect(settled).toBe(true);
}

async function addPeerToSelectedGroup(
  pane: HTMLElement,
  peerUserId: string,
  onBeforeAdd: () => void,
) {
  const userIdInput = within(pane).getByLabelText("User ID");
  invariant(
    userIdInput instanceof HTMLInputElement,
    "Expected group user id input.",
  );
  const addButton = within(pane).getByRole("button", { name: "Add" });
  invariant(addButton instanceof HTMLButtonElement, "Expected add button.");
  await interact(() => {
    fireEvent.change(userIdInput, { target: { value: peerUserId } });
  });
  await waitFor(() => {
    expect(addButton.disabled).toBe(false);
  });
  onBeforeAdd();
  await interact(() => {
    fireEvent.click(addButton);
  });
  await waitFor(
    () => {
      expect(userIdInput.value).toBe("");
    },
    { timeout: GROUP_MUTATION_TIMEOUT_MS },
  );
  await waitFor(
    () => {
      expect(
        Array.from(
          pane.querySelectorAll(".org-manager-member-row strong"),
        ).some((element) => element.getAttribute("title") === peerUserId),
      ).toBe(true);
    },
    { timeout: GROUP_MUTATION_TIMEOUT_MS },
  );
  await act(async () => {
    await waitForAppTestRuntimeToSettle({
      apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
      timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
    });
  });
}

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

test(
  "an active peer Org Manager reconciles an ungranted group mutation without container fanout",
  async () => {
    useTestApiAppHandlers();
    const view = renderDualPane();
    const founderPane = getPaneRoot(view, "left");
    const peerPane = getPaneRoot(view, "right");

    await waitForDualPaneProvisioning(founderPane, peerPane);
    await act(async () => {
      await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
      });
    });

    const peerUserId = getPaneUserId(peerPane);
    const founderSession = readAuthenticatedSession(getPaneUserId(founderPane));
    const peerSession = readAuthenticatedSession(peerUserId);

    // Establish the peer as an active roster member and admin so its access to
    // the founder org stays stable throughout the measured custom-group change.
    // The custom group has no container grants, which makes any peer container
    // or document request in the measured slice an organization-hint fanout.
    await importPeerIntoRoster(founderPane, peerUserId);
    await addPeerToAdminsGroup(founderPane, peerUserId);
    await createOrganizationGroup(founderPane, "Realtime Budget Observers");
    await switchMountedOrgManagerToForeignOrganization({
      founderOrganizationId: founderSession.organizationId,
      pane: peerPane,
      peerAuthorization: peerSession.authorization,
    });

    let mutationRequestStartIndex = listProxiedApiRequests().length;
    const getDroppedShareNotificationCount = dropNextMswServerEventWhere(
      (event) =>
        Reflect.get(event, "type") === "shared_with_you" &&
        Reflect.get(event, "userId") === peerUserId,
    );
    await addPeerToSelectedGroup(founderPane, peerUserId, () => {
      mutationRequestStartIndex = listProxiedApiRequests().length;
    });

    const peerMutationRequests = listProxiedApiRequests()
      .slice(mutationRequestStartIndex)
      .filter((request) => request.authorization === peerSession.authorization);
    const peerReadModelRequests = peerMutationRequests.filter(
      (request) =>
        request.method === "GET" &&
        requestPath(request.url) ===
          `/organizations/${founderSession.organizationId}/read-model`,
    );
    const peerContainerOrDocumentRequests = peerMutationRequests.filter(
      (request) => isContainerOrDocumentRequest(request.url),
    );
    expect(getDroppedShareNotificationCount()).toBe(0);
    expect(
      peerMutationRequests.map(
        (request) => `${request.method} ${requestPath(request.url)}`,
      ),
    ).toEqual([
      `GET /organizations/${founderSession.organizationId}/read-model`,
    ]);
    expect(peerReadModelRequests).toHaveLength(1);
    expect(
      peerContainerOrDocumentRequests.map(
        (request) => `${request.method} ${request.url}`,
      ),
    ).toEqual([]);
  },
  DUAL_PANE_ATTACHMENT_TEST_TIMEOUT_MS,
);
