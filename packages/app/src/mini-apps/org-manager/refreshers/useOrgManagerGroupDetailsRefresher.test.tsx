import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
} from "@symcrypt/client-sdk";
import { cleanup, render } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import type { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { useOrgManagerGroupDetailsRefresher } from "./useOrgManagerGroupDetailsRefresher";

afterEach(() => cleanup());

const projectedMembers: OrganizationGroupMembers = {
  organizationId: "org-a",
  groupId: "group-a",
  members: [],
};
const staleMembers: OrganizationGroupMembers = {
  organizationId: "org-a",
  groupId: "group-a",
  members: [
    {
      encapsulationKeyFingerprint: null,
      encapsulationPublicKey: null,
      role: "member",
      signingKeyFingerprint: null,
      signingPublicKey: null,
      userId: "stale-user",
    },
  ],
};

interface DetailActions {
  invalidateAndProject: () => void;
  refresh: (groupId: string | null) => Promise<void>;
}

function DetailProbe(input: {
  capture: (actions: DetailActions) => void;
  loadDetails: ReturnType<
    typeof useOrgManagerActions
  >["loadGroupPresentationDetails"];
  setMembers: Dispatch<SetStateAction<OrganizationGroupMembers | null>>;
}) {
  const beginRequest = useOrgManagerRequestGuard("org-a");
  const refresh = useOrgManagerGroupDetailsRefresher({
    appData: {
      auth: { isAuthenticated: true, organizationId: "org-a" },
    } as ReturnType<typeof useSymCryptRuntime>,
    beginRequest,
    markGroupDetailsSettled: () => undefined,
    orgManagerActions: {
      loadGroupPresentationDetails: input.loadDetails,
    } as ReturnType<typeof useOrgManagerActions>,
    setError: () => {},
    setGroupPolicyHistory: () => {},
    setMembers: input.setMembers,
  });
  const invalidateAndProject = useCallback(() => {
    beginRequest("groupDetails");
    input.setMembers(projectedMembers);
  }, [beginRequest, input.setMembers]);
  useEffect(
    () => input.capture({ invalidateAndProject, refresh }),
    [input.capture, invalidateAndProject, refresh],
  );
  return null;
}

test("mutation projection invalidation rejects a deferred stale group detail", async () => {
  let resolveDetails: (details: {
    members: OrganizationGroupMembers | null;
    policyHistory: OrganizationGroupPolicyHistory | null;
  }) => void = () => {};
  const pendingDetails = new Promise<{
    members: OrganizationGroupMembers | null;
    policyHistory: OrganizationGroupPolicyHistory | null;
  }>((resolve) => {
    resolveDetails = resolve;
  });
  const updates: Array<OrganizationGroupMembers | null> = [];
  const captured: { actions: DetailActions | null } = { actions: null };

  render(
    <DetailProbe
      capture={(next) => {
        captured.actions = next;
      }}
      loadDetails={() => pendingDetails}
      setMembers={(next) => {
        updates.push(typeof next === "function" ? next(null) : next);
      }}
    />,
  );
  const actions = captured.actions;
  if (!actions) {
    throw new Error("Expected group detail actions");
  }

  const staleRefresh = actions.refresh("group-a");
  actions.invalidateAndProject();
  resolveDetails({ members: staleMembers, policyHistory: null });
  await staleRefresh;

  expect(updates).toEqual([projectedMembers]);
});
