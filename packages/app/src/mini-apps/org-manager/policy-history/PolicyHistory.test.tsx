import { afterEach, expect, test } from "bun:test";
import type { OrganizationPolicyHistory } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { PolicyHistorySection } from "./PolicyHistory";

afterEach(cleanup);

const EMPTY_HISTORY: OrganizationPolicyHistory = {
  entries: [],
  organizationId: "org-a",
  principalId: "org-a",
  principalType: "organization",
};

function renderSection(
  overrides: Partial<Parameters<typeof PolicyHistorySection>[0]> = {},
) {
  return render(
    <PolicyHistorySection directory={null} history={null} {...overrides} />,
  );
}

test("history that has not been fetched yet reads as loading", () => {
  // Policy history arrives on its own refresh, after the section first paints.
  // Without a pending signal every visit flashed "unavailable" first.
  const view = renderSection({ pending: true });

  expect(view.getByText(ORG_MANAGER_LABELS.loadingPolicyHistory)).toBeTruthy();
  expect(
    view.queryByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeNull();
});

test("a settled absent history reports itself as unavailable", () => {
  const view = renderSection({ pending: false });

  expect(
    view.getByText(ORG_MANAGER_LABELS.policyHistoryUnavailable),
  ).toBeTruthy();
});

test("a settled empty history is not an unavailable one", () => {
  const view = renderSection({ history: EMPTY_HISTORY, pending: false });

  expect(view.getByText(ORG_MANAGER_LABELS.noPolicyHistory)).toBeTruthy();
});

const historyWithAddition: OrganizationPolicyHistory = {
  ...EMPTY_HISTORY,
  entries: [
    {
      changes: [],
      createdAt: "2026-09-24T12:00:00Z",
      signedAt: "2026-09-24T12:00:00Z",
      keyEpoch: 3,
      memberCount: 1,
      signerUserId: "admin-user",
      signerUserKeyFingerprint: "fingerprint",
      stateHash: "history-head",
      version: 3,
      groupChanges: [
        {
          groupId: "support-group",
          changeType: "updated",
          previousVersion: 1,
          version: 2,
          previousKeyEpoch: 1,
          keyEpoch: 1,
          changes: [
            {
              changeType: "added",
              userId: "member-user",
              previousRole: null,
              nextRole: "member",
            },
          ],
          grantChanges: [],
        },
      ],
    },
  ],
};

test("organization history shows group details and resolves current roster names", () => {
  const groups = [
    {
      groupId: "support-group",
      organizationId: "org-a",
      name: "Support",
      createdAt: "2026-09-24T12:00:00Z",
      isBuiltin: false,
      currentState: null,
    },
  ];
  const view = renderSection({
    history: historyWithAddition,
    groups,
    profileDisplayNamesByUserId: new Map([["member-user", "Alice"]]),
  });
  expect(view.getByText("Group updated: Support")).toBeTruthy();
  expect(view.getByText(/Alice/)).toBeTruthy();
  expect(view.queryByText(ORG_MANAGER_LABELS.noMembershipChanges)).toBeNull();
  view.rerender(
    <PolicyHistorySection
      directory={null}
      history={historyWithAddition}
      groups={groups}
      profileDisplayNamesByUserId={new Map([["member-user", "Alicia"]])}
    />,
  );
  expect(view.getByText(/Alicia/)).toBeTruthy();
  expect(view.queryByText(/Alice/)).toBeNull();
});

test("unavailable group evidence is explicit and unresolved names use identifiers", () => {
  const view = renderSection({ history: historyWithAddition });
  expect(view.getByTitle("support-group")).toBeTruthy();
  expect(view.getByTitle("member-user")).toBeTruthy();
  cleanup();
  const entry = historyWithAddition.entries[0];
  if (!entry) throw new Error("Expected history entry");
  const missing = renderSection({
    history: {
      ...historyWithAddition,
      entries: [{ ...entry, groupChanges: null }],
    },
  });
  expect(
    missing.getByText(ORG_MANAGER_LABELS.policyGroupDetailsUnavailable),
  ).toBeTruthy();
  expect(
    missing.queryByText(ORG_MANAGER_LABELS.noMembershipChanges),
  ).toBeNull();
});

test("group detail hides exact mirrored changes while retaining other organization changes", () => {
  const entry = historyWithAddition.entries[0];
  const mirrored = entry?.groupChanges?.[0]?.changes[0];
  if (!entry || !mirrored) throw new Error("Expected membership fixture");
  const view = renderSection({
    history: {
      ...historyWithAddition,
      entries: [
        {
          ...entry,
          changes: [
            mirrored,
            { ...mirrored, userId: "another-admin", nextRole: "admin" },
          ],
        },
      ],
    },
    profileDisplayNamesByUserId: new Map([
      ["member-user", "Alice"],
      ["another-admin", "Bob"],
    ]),
  });
  expect(view.getAllByText(/Alice/)).toHaveLength(1);
  expect(view.getByText(/Bob/)).toBeTruthy();
});

test("history renders deletion, grant changes, key rotation, and policy-only updates", () => {
  const entry = historyWithAddition.entries[0];
  const group = entry?.groupChanges?.[0];
  if (!entry || !group) throw new Error("Expected group fixture");
  const view = renderSection({
    history: {
      ...historyWithAddition,
      entries: [
        {
          ...entry,
          groupChanges: [
            { ...group, changeType: "deleted", changes: [] },
            {
              ...group,
              groupId: "rotated-group",
              keyEpoch: 2,
              changes: [],
              grantChanges: [
                {
                  containerId: "container-added",
                  previousAccess: null,
                  nextAccess: "read",
                },
                {
                  containerId: "container-upgraded",
                  previousAccess: "read",
                  nextAccess: "write",
                },
                {
                  containerId: "container-removed",
                  previousAccess: "write",
                  nextAccess: null,
                },
              ],
            },
          ],
        },
        { ...entry, stateHash: "policy-only", version: 4, groupChanges: [] },
      ],
    },
  });
  expect(view.getByText(/Group deleted:/)).toBeTruthy();
  expect(view.getByText("Group key rotated: 1 → 2")).toBeTruthy();
  expect(view.getByText(/None → read/)).toBeTruthy();
  expect(view.getByText(/read → write/)).toBeTruthy();
  expect(view.getByText(/write → None/)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.policyUpdated)).toBeTruthy();
});
