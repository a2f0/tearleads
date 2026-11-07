import { afterEach, expect, test } from "bun:test";
import type { OrganizationDeviceDataUsage } from "@tearleads/client-sdk";
import {
  useWindowRefreshMenuItem,
  useWindowRefreshMenuItemValue,
  WindowMenuProvider,
} from "@tearleads/windowing";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ContextType, PropsWithChildren } from "react";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { OrgManagerContext } from "../../../stores/org-manager/OrgManagerProvider";
import { DATA_USAGE_LABELS } from "../../shared/dataUsageLabels";
import { OrgManagerUsageView } from "./OrgManagerUsageView";

afterEach(() => cleanup());

function deviceUsage(organizationId: string): OrganizationDeviceDataUsage {
  return {
    blobs: { blobCount: 2, byteLength: 4096 },
    documents: {
      breakdown: [
        { byteLength: 0, category: "containerMetadata", documentCount: 0 },
        { byteLength: 300, category: "rosterProfiles", documentCount: 1 },
        { byteLength: 0, category: "organizationMetadata", documentCount: 0 },
        { byteLength: 724, category: "user", documentCount: 2 },
      ],
      byteLength: 1024,
      documentCount: 3,
    },
    organizationId,
    totalByteLength: 5120,
  };
}

const SYNCED_USAGE = {
  blobs: { blobCount: 0, byteLength: 0 },
  documents: {
    breakdown: [],
    byteLength: 0,
    documentCount: 0,
    updateCount: 0,
  },
  organizationId: "org-a",
  totalByteLength: 0,
};

function ToolbarProbe() {
  const refresh = useWindowRefreshMenuItemValue();
  return refresh ? (
    <button
      aria-label={refresh.label}
      disabled={refresh.disabled}
      type="button"
      onClick={refresh.onClick}
    />
  ) : null;
}

// Stands in for Org Manager's roster-wide refresh, registered at the default
// priority beneath the Usage view.
function RosterRefresh({ onRefresh }: { onRefresh: () => void }) {
  useWindowRefreshMenuItem({ onRefresh });
  return null;
}

function renderUsageView(input: {
  loadDeviceDataUsage: () => Promise<OrganizationDeviceDataUsage | null>;
  organizationId?: string;
  rosterRefresh?: () => void;
}) {
  const actions = {
    loadDeviceDataUsage: input.loadDeviceDataUsage,
  } as unknown as NonNullable<ContextType<typeof OrgManagerContext>>;
  function Providers({ children }: PropsWithChildren) {
    return (
      <LogProvider>
        <OrgManagerContext.Provider value={actions}>
          <WindowMenuProvider>
            <RosterRefresh onRefresh={input.rosterRefresh ?? (() => {})} />
            <ToolbarProbe />
            {children}
          </WindowMenuProvider>
        </OrgManagerContext.Provider>
      </LogProvider>
    );
  }
  const view = (organizationId: string) => (
    <OrgManagerUsageView
      canSync={true}
      dataUsage={SYNCED_USAGE}
      organizationId={organizationId}
      pending={false}
    />
  );
  const result = render(view(input.organizationId ?? "org-a"), {
    wrapper: Providers,
  });
  return {
    ...result,
    openDeviceTab: () =>
      fireEvent.click(
        result.getByRole("tab", { name: DATA_USAGE_LABELS.usageDeviceTab }),
      ),
    openSyncedTab: () =>
      fireEvent.click(
        result.getByRole("tab", { name: DATA_USAGE_LABELS.usageSyncedTab }),
      ),
    switchOrganization: (organizationId: string) =>
      result.rerender(view(organizationId)),
  };
}

test("usage opens on the synced tab without measuring the device", () => {
  let measureCount = 0;
  const view = renderUsageView({
    loadDeviceDataUsage: async () => {
      measureCount += 1;
      return deviceUsage("org-a");
    },
  });

  const syncedTab = view.getByRole("tab", {
    name: DATA_USAGE_LABELS.usageSyncedTab,
  });
  expect(syncedTab.getAttribute("aria-selected")).toBe("true");
  expect(view.getByText(DATA_USAGE_LABELS.organizationDataUsage)).toBeTruthy();
  expect(view.queryByText(DATA_USAGE_LABELS.deviceDataUsage)).toBeNull();
  expect(measureCount).toBe(0);
});

test("the on device tab shows measured documents, categories, and files", async () => {
  const view = renderUsageView({
    loadDeviceDataUsage: async () => deviceUsage("org-a"),
  });

  view.openDeviceTab();

  expect(await view.findByText("3 documents")).toBeTruthy();
  expect(view.getByText(DATA_USAGE_LABELS.deviceDataUsage)).toBeTruthy();
  expect(view.queryByText(DATA_USAGE_LABELS.organizationDataUsage)).toBeNull();
  const profiles = view
    .getByText(DATA_USAGE_LABELS.usageCategoryRosterProfiles)
    .closest(".organization-usage-subrow");
  expect(profiles).toBeTruthy();
  expect(within(profiles as HTMLElement).getByText("1 document")).toBeTruthy();
  expect(within(profiles as HTMLElement).getByText("300 B")).toBeTruthy();
  expect(view.getByText(DATA_USAGE_LABELS.usageCategoryUser)).toBeTruthy();
  // Empty categories stay hidden, as in the synced view.
  expect(
    view.queryByText(DATA_USAGE_LABELS.usageCategoryContainerMetadata),
  ).toBeNull();
  expect(view.getByText("2 files")).toBeTruthy();
  expect(view.getByText("4.0 KB")).toBeTruthy();
  expect(view.getByText("5.0 KB")).toBeTruthy();
});

test("on device usage reports unavailable and failed measurements", async () => {
  const unavailable = renderUsageView({
    loadDeviceDataUsage: async () => null,
  });
  unavailable.openDeviceTab();
  expect(
    await unavailable.findByText(DATA_USAGE_LABELS.deviceUsageUnavailable),
  ).toBeTruthy();
  cleanup();

  const failed = renderUsageView({
    loadDeviceDataUsage: async () => {
      throw new Error("database locked");
    },
  });
  failed.openDeviceTab();
  expect(
    await failed.findByText(DATA_USAGE_LABELS.deviceUsageFailed),
  ).toBeTruthy();
});

test("toolbar Refresh re-measures on device, then returns to the roster refresh", async () => {
  let measureCount = 0;
  let rosterRefreshCount = 0;
  const view = renderUsageView({
    loadDeviceDataUsage: async () => {
      measureCount += 1;
      return deviceUsage("org-a");
    },
    rosterRefresh: () => {
      rosterRefreshCount += 1;
    },
  });

  view.openDeviceTab();
  await view.findByText("3 documents");
  expect(measureCount).toBe(1);

  const refresh = view.getByRole("button", { name: "Refresh" });
  await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
  fireEvent.click(refresh);
  await waitFor(() => expect(measureCount).toBe(2));
  expect(rosterRefreshCount).toBe(0);

  view.openSyncedTab();
  fireEvent.click(view.getByRole("button", { name: "Refresh" }));
  expect(rosterRefreshCount).toBe(1);
  expect(measureCount).toBe(2);
});

test("switching organizations drops the previous organization's measurement", async () => {
  const second = Promise.withResolvers<OrganizationDeviceDataUsage>();
  let measureCount = 0;
  const view = renderUsageView({
    loadDeviceDataUsage: () => {
      measureCount += 1;
      return measureCount === 1
        ? Promise.resolve(deviceUsage("org-a"))
        : second.promise;
    },
  });

  view.openDeviceTab();
  await view.findByText("3 documents");

  view.switchOrganization("org-b");
  expect(
    await view.findByText(DATA_USAGE_LABELS.loadingDeviceDataUsage),
  ).toBeTruthy();
  expect(view.queryByText("3 documents")).toBeNull();

  second.resolve(deviceUsage("org-b"));
  expect(await view.findByText("3 documents")).toBeTruthy();
});
