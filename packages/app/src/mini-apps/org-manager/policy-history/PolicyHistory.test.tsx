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
    <PolicyHistorySection
      directory={null}
      heading={ORG_MANAGER_LABELS.organizationPolicyHistory}
      history={null}
      {...overrides}
    />,
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
