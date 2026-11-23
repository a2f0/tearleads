import "../../../../test/helpers/msw/server";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  useWindowRefreshMenuItem,
  WindowMenuProvider,
  WindowToolBar,
} from "@tearleads/windowing";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../../../test/helpers/identityManagerTestRuntime";
import { DATA_USAGE_LABELS } from "../../shared/dataUsageLabels";
import { OrgManagerUsageView } from "./OrgManagerUsageView";

const hostConfig = createIdentityManagerHostConfig();
afterEach(cleanupIdentityManagerTestEnvironment);

const PENDING_PAGE = {
  ok: true as const,
  data: {
    blobs: [
      {
        blobId: "private-pending-blob",
        organizationId: "organization-a",
        byteLength: 4096,
        status: "eligible" as const,
        dereferencedAt: "2026-11-12T10:00:00.000Z",
        eligibleAfter: "2026-11-13T10:00:00.000Z",
        reclaimAttemptedAt: null,
        prunedAt: null,
        objectDeleteAttemptedAt: null,
      },
    ],
    nextAfterId: null,
  },
};

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
  ).mockResolvedValue(PENDING_PAGE);
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

test("the pending deletion tab takes the window Refresh over from Org Manager's own", async () => {
  const sdkRef: { current: Tearleads | null } = { current: null };
  const orgManagerRefresh = mock();
  // Stands in for the roster-wide Refresh Org Manager registers.
  function OrgManagerRefresh() {
    useWindowRefreshMenuItem({ onRefresh: orgManagerRefresh });
    return null;
  }
  const content = (isOrgAdmin: boolean) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={(sdk) => {
        sdkRef.current = sdk;
      }}
    >
      <WindowMenuProvider>
        <WindowToolBar />
        <OrgManagerRefresh />
        <OrgManagerUsageView
          canSync={true}
          dataUsage={null}
          isOrgAdmin={isOrgAdmin}
          organizationId="organization-a"
          pending={false}
        />
      </WindowMenuProvider>
    </IdentityManagerTestRuntime>
  );
  const view = render(content(false));
  await waitFor(() => expect(sdkRef.current).toBeTruthy());
  const sdk = sdkRef.current;
  if (!sdk) throw new Error("Expected the real SDK runtime");
  const request = spyOn(
    sdk.organizations,
    "listPendingBlobDeletions",
  ).mockResolvedValue(PENDING_PAGE);
  // Waits for an idle Refresh: the toolbar shows a registration a render
  // after the view, so the queue can show while it still reads
  // "Refreshing...".
  const clickRefresh = async () =>
    fireEvent.click(
      await within(view.getByRole("toolbar")).findByRole("button", {
        name: "Refresh",
      }),
    );
  try {
    view.rerender(content(true));
    fireEvent.click(
      view.getByRole("tab", {
        name: DATA_USAGE_LABELS.usagePendingDeletionTab,
      }),
    );
    await view.findByText("private-pending-blob");
    expect(request).toHaveBeenCalledTimes(1);
    await clickRefresh();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(orgManagerRefresh).not.toHaveBeenCalled();

    // Leaving the tab hands Refresh back to Org Manager.
    fireEvent.click(
      view.getByRole("tab", { name: DATA_USAGE_LABELS.usageSyncedTab }),
    );
    await clickRefresh();
    expect(orgManagerRefresh).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    request.mockRestore();
  }
});
