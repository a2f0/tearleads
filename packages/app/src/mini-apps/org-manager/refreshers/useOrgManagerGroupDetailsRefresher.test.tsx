import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
} from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import type { GroupDetailsRefreshOptions } from "../refresh";
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

const olderHistory: OrganizationGroupPolicyHistory = {
  groupId: "group-a",
  organizationId: "org-a",
  principalType: "group",
  principalId: "group-a",
  nextBeforeVersion: 2,
  entries: [
    {
      changes: [],
      createdAt: "2026-10-07T00:00:00.000Z",
      signedAt: "2026-10-07T00:00:00.000Z",
      keyEpoch: 1,
      memberCount: 1,
      signerUserId: "user-a",
      signerUserKeyFingerprint: "signer-key",
      stateHash: "state-2",
      version: 2,
    },
  ],
};

interface DetailActions {
  invalidateAndProject: () => void;
  refresh: (
    groupId: string | null,
    options?: GroupDetailsRefreshOptions,
  ) => Promise<void>;
}

function DetailProbe(input: {
  capture: (actions: DetailActions) => void;
  loadDetails: ReturnType<
    typeof useOrgManagerActions
  >["loadGroupPresentationDetails"];
  setMembers: Dispatch<SetStateAction<OrganizationGroupMembers | null>>;
  markSettled?: (groupId: string | null) => void;
}) {
  const beginRequest = useOrgManagerRequestGuard("org-a");
  const refresh = useOrgManagerGroupDetailsRefresher({
    appData: {
      auth: { isAuthenticated: true, organizationId: "org-a" },
    } as ReturnType<typeof useTearleadsRuntime>,
    beginRequest,
    markGroupDetailsSettled: input.markSettled ?? (() => undefined),
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

test.each(["group-a", "group-b"])(
  "an older page cannot cancel a full %s refresh or replace its members",
  async (groupId) => {
    const full = Promise.withResolvers<{
      members: OrganizationGroupMembers | null;
      policyHistory: OrganizationGroupPolicyHistory | null;
    }>();
    const updates: Array<OrganizationGroupMembers | null> = [];
    const settled: Array<string | null> = [];
    const captured: { actions: DetailActions | null } = { actions: null };
    render(
      <DetailProbe
        capture={(next) => {
          captured.actions = next;
        }}
        loadDetails={(_, beforeVersion) =>
          beforeVersion === undefined
            ? full.promise
            : Promise.resolve({
                members: staleMembers,
                policyHistory: olderHistory,
              })
        }
        markSettled={(id) => settled.push(id)}
        setMembers={(next) => {
          updates.push(typeof next === "function" ? next(null) : next);
        }}
      />,
    );
    const actions = captured.actions;
    if (!actions) throw new Error("Expected group detail actions");
    const freshRefresh = actions.refresh(groupId);
    await actions.refresh("group-a", { beforeVersion: 3 });
    const freshMembers = { ...projectedMembers, groupId };
    full.resolve({ members: freshMembers, policyHistory: null });
    await freshRefresh;
    expect(updates).toEqual([freshMembers]);
    expect(settled).toEqual([groupId]);
  },
);
