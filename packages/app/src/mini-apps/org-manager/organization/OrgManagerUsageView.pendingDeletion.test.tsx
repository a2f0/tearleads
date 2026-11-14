import "../../../../test/helpers/msw/server";
import { afterEach, expect, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../../../test/helpers/identityManagerTestRuntime";
import { DATA_USAGE_LABELS } from "../../shared/dataUsageLabels";
import { OrgManagerUsageView } from "./OrgManagerUsageView";

const hostConfig = createIdentityManagerHostConfig();
afterEach(cleanupIdentityManagerTestEnvironment);

test("pending deletion is admin-only and losing admin access removes the visible metadata", async () => {
  const sdkRef: { current: Tearleads | null } = { current: null };
  const content = (isOrgAdmin: boolean) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={(sdk) => {
        sdkRef.current = sdk;
      }}
    >
      <OrgManagerUsageView
        canSync={true}
        dataUsage={null}
        isOrgAdmin={isOrgAdmin}
        organizationId="organization-a"
        pending={false}
      />
    </IdentityManagerTestRuntime>
  );
  const view = render(content(false));
  const pendingTab = { name: DATA_USAGE_LABELS.usagePendingDeletionTab };
  expect(view.queryByRole("tab", pendingTab)).toBeNull();
  await waitFor(() => expect(sdkRef.current).toBeTruthy());
  const sdk = sdkRef.current;
  if (!sdk) throw new Error("Expected the real SDK runtime");
  const request = spyOn(
    sdk.organizations,
    "listPendingBlobDeletions",
  ).mockResolvedValue({
    ok: true,
    data: {
      blobs: [
        {
          blobId: "private-pending-blob",
          organizationId: "organization-a",
          byteLength: 4096,
          status: "eligible",
          dereferencedAt: "2026-11-12T10:00:00.000Z",
          eligibleAfter: "2026-11-13T10:00:00.000Z",
          reclaimAttemptedAt: null,
          prunedAt: null,
          objectDeleteAttemptedAt: null,
        },
      ],
      nextAfterId: null,
    },
  });
  try {
    view.rerender(content(true));
    fireEvent.click(view.getByRole("tab", pendingTab));
    await view.findByText("private-pending-blob");
    view.rerender(content(false));
    expect(view.queryByRole("tab", pendingTab)).toBeNull();
    expect(view.queryByText("private-pending-blob")).toBeNull();
    expect(
      view.queryByRole("table", { name: "Pending blob deletions" }),
    ).toBeNull();
    expect(
      view
        .getByRole("tab", { name: DATA_USAGE_LABELS.usageSyncedTab })
        .getAttribute("aria-selected"),
    ).toBe("true");
  } finally {
    request.mockRestore();
  }
});
