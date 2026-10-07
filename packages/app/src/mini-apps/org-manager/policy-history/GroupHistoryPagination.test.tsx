import { afterEach, expect, test } from "bun:test";
import type { OrganizationGroupPolicyHistory } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { getOrgManagerPolicyVersionLabel } from "../labels";
import { useOrgManagerGroupDetailsRefresher } from "../refreshers/useOrgManagerGroupDetailsRefresher";
import { loadOlderGroupPolicyHistory } from "./groupPolicyHistoryPages";
import { PolicyHistorySection } from "./PolicyHistory";

afterEach(cleanup);

function page(
  versions: number[],
  nextBeforeVersion: number | null,
): OrganizationGroupPolicyHistory {
  return {
    groupId: "group-a",
    organizationId: "org-a",
    principalType: "group",
    principalId: "group-a",
    nextBeforeVersion,
    entries: versions.map((version) => ({
      changes: [],
      createdAt: "2026-10-07T00:00:00.000Z",
      signedAt: "2026-10-07T00:00:00.000Z",
      keyEpoch: 1,
      memberCount: 1,
      signerUserId: "user-a",
      signerUserKeyFingerprint: "signer-key",
      stateHash: `state-${version}`,
      version,
    })),
  };
}

function PaginationProbe({
  load,
}: {
  load: ReturnType<typeof useOrgManagerActions>["loadGroupPresentationDetails"];
}) {
  const [history, setHistory] = useState<OrganizationGroupPolicyHistory | null>(
    page([3], 3),
  );
  const [error, setError] = useState<string | null>(null);
  const beginRequest = useOrgManagerRequestGuard("org-a");
  const refresh = useOrgManagerGroupDetailsRefresher({
    appData: {
      auth: { isAuthenticated: true, organizationId: "org-a" },
    } as ReturnType<typeof useTearleadsRuntime>,
    beginRequest,
    markGroupDetailsSettled: () => {},
    orgManagerActions: {
      loadGroupPresentationDetails: load,
    } as ReturnType<typeof useOrgManagerActions>,
    setError,
    setGroupPolicyHistory: setHistory,
    setMembers: () => {},
  });
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <PolicyHistorySection
        directory={null}
        history={history}
        loadMore={() => loadOlderGroupPolicyHistory(history, refresh)}
      />
    </>
  );
}

test("history pagination carries its exclusive cursor and preserves the visible page while loading", async () => {
  const waiting = Promise.withResolvers<void>();
  const calls: Array<[string, number | undefined]> = [];
  const view = render(
    <PaginationProbe
      load={async (groupId, beforeVersion) => {
        calls.push([groupId, beforeVersion]);
        await waiting.promise;
        return {
          members: { groupId, organizationId: "org-a", members: [] },
          policyHistory: page([2, 1], null),
        };
      }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Load older changes" }));
  expect(calls).toEqual([["group-a", 3]]);
  expect(
    view
      .getByRole("button", { name: "Loading older changes…" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(view.getByText(getOrgManagerPolicyVersionLabel(3))).toBeTruthy();
  await act(async () => waiting.resolve());
  await waitFor(() =>
    expect(view.getByText(getOrgManagerPolicyVersionLabel(1))).toBeTruthy(),
  );
  expect(
    view.container.querySelectorAll(".org-manager-policy-history-row"),
  ).toHaveLength(3);
  expect(view.queryByRole("button", { name: "Load older changes" })).toBeNull();
});

test("a failed older-page read keeps the verified rows and permits retry", async () => {
  const view = render(
    <PaginationProbe
      load={async () => {
        throw new Error("History is offline");
      }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Load older changes" }));
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("History is offline"),
  );
  expect(view.getByText(getOrgManagerPolicyVersionLabel(3))).toBeTruthy();
  await waitFor(() =>
    expect(
      view
        .getByRole("button", { name: "Load older changes" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
});
