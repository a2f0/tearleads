import { afterEach, expect, test } from "bun:test";
import type { OrganizationPolicyHistory } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { getOrgManagerPolicyVersionLabel } from "../labels";
import { useOrgManagerOrganizationHistoryRefresher } from "../refreshers/useOrgManagerOrganizationHistoryRefresher";
import { PolicyHistorySection } from "./PolicyHistory";

afterEach(cleanup);

function page(
  versions: number[],
  nextBeforeVersion: number | null,
): OrganizationPolicyHistory {
  return {
    organizationId: "org-a",
    principalType: "organization",
    principalId: "org-a",
    nextBeforeVersion,
    entries: versions.map((version) => ({
      changes: [],
      groupChanges: [],
      createdAt: "2026-10-07T00:00:00.000Z",
      signedAt: "2026-10-07T00:00:00.000Z",
      keyEpoch: 1,
      memberCount: 1,
      signerUserId: "user-a",
      signerUserKeyFingerprint: "signer",
      stateHash: `state-${version}`,
      version,
    })),
  };
}

function Probe({
  load,
}: {
  load: ReturnType<typeof useOrgManagerActions>["loadPolicyHistory"];
}) {
  const [history, setHistory] = useState<OrganizationPolicyHistory | null>(
    page([3], 3),
  );
  const [error, setError] = useState<string | null>(null);
  const beginRequest = useOrgManagerRequestGuard("org-a");
  const loadMore = useOrgManagerOrganizationHistoryRefresher({
    beginRequest,
    history,
    setError,
    setOrganizationPolicyHistory: setHistory,
    orgManagerActions: { loadPolicyHistory: load } as ReturnType<
      typeof useOrgManagerActions
    >,
  });
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => {
          beginRequest("organizationPolicyHistory");
          setHistory(page([4, 3], 3));
        }}
      >
        Refresh history
      </button>
      <PolicyHistorySection
        directory={null}
        history={history}
        loadMore={loadMore}
      />
    </>
  );
}

test("organization pagination retries failures and carries the exclusive cursor", async () => {
  let attempts = 0;
  const waiting = Promise.withResolvers<void>();
  const view = render(
    <Probe
      load={async (beforeVersion) => {
        expect(beforeVersion).toBe(3);
        if (++attempts === 1)
          throw new Error("History temporarily unavailable");
        await waiting.promise;
        return page([2, 1], null);
      }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Load older changes" }));
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain(
      "temporarily unavailable",
    ),
  );
  expect(view.getByText(getOrgManagerPolicyVersionLabel(3))).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Load older changes" }));
  expect(
    view
      .getByRole("button", { name: "Loading older changes…" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => waiting.resolve());
  await waitFor(() =>
    expect(view.getByText(getOrgManagerPolicyVersionLabel(1))).toBeTruthy(),
  );
  expect(
    view.container.querySelectorAll(".org-manager-policy-history-row"),
  ).toHaveLength(3);
  expect(view.queryByRole("alert")).toBeNull();
});

test("a full organization refresh invalidates a late older page even with the same cursor", async () => {
  const waiting = Promise.withResolvers<void>();
  const view = render(
    <Probe
      load={async () => {
        await waiting.promise;
        return page([2, 1], null);
      }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Load older changes" }));
  fireEvent.click(view.getByRole("button", { name: "Refresh history" }));
  await act(async () => waiting.resolve());
  expect(view.getByText(getOrgManagerPolicyVersionLabel(4))).toBeTruthy();
  expect(view.queryByText(getOrgManagerPolicyVersionLabel(1))).toBeNull();
  expect(
    view.container.querySelectorAll(".org-manager-policy-history-row"),
  ).toHaveLength(2);
});

test.each([
  null,
  { ...page([2, 1], null), organizationId: "other" },
  page([2, 2], null),
  page([2], null),
])(
  "invalid organization pages leave the visible history intact: %j",
  async (invalid) => {
    const view = render(<Probe load={async () => invalid} />);
    fireEvent.click(view.getByRole("button", { name: "Load older changes" }));
    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(
      view.container.querySelectorAll(".org-manager-policy-history-row"),
    ).toHaveLength(1);
  },
);
