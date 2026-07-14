import { afterEach, expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { render, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { useEffect } from "react";
import { registerAndWaitForUserId } from "../../../../test/helpers/identityPaneTestUtils";
import { useTestApiAppHandlers } from "../../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  openContacts,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/paneTestUtils";
import { CONTACTS_LABELS } from "../../../mini-apps/contacts/labels";
import {
  saveSystemMonitorMode,
  systemMonitorModeStorageKey,
} from "../../../mini-apps/system-monitor/systemMonitorMode";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { DualPaneProvider, PaneSideProvider } from "../dual-pane";
import { Pane } from "../Pane";
import { PaneProvider } from "../PaneProvider";

afterEach(cleanupPaneTestEnvironment);

function TearleadsProbe({
  onReady,
}: {
  readonly onReady: (tearleads: Tearleads) => void;
}) {
  const tearleads = useTearleads();
  useEffect(() => onReady(tearleads), [onReady, tearleads]);
  return null;
}

test(
  "fresh Contacts recovers when the personal organization index catches up",
  async () => {
    useTestApiAppHandlers();
    saveSystemMonitorMode(systemMonitorModeStorageKey("left"), "pinned");
    const tearleadsRef: { current: Tearleads | null } = { current: null };
    const view = render(
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider
            autoProvisionEnabled={false}
            hostConfig={createTestHostConfig()}
          >
            <TearleadsProbe
              onReady={(nextTearleads) => {
                tearleadsRef.current = nextTearleads;
              }}
            />
            <Pane className="pane" />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>,
    );

    await waitFor(() => expect(tearleadsRef.current).not.toBeNull());
    const tearleads = tearleadsRef.current;
    invariant(tearleads, "Tearleads runtime was not captured");
    const organizations = tearleads.organizations;
    const listPersistedOrganizations =
      organizations.listLocalOrganizations.bind(organizations);
    let organizationIndexVisible = false;
    let organizationLookupCount = 0;
    organizations.listLocalOrganizations = async () => {
      organizationLookupCount += 1;
      return organizationIndexVisible ? listPersistedOrganizations() : [];
    };

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);
    const contactsWindow = await openContacts(view);

    await waitFor(() => {
      expect(
        within(contactsWindow).getByText(CONTACTS_LABELS.loadingState),
      ).toBeTruthy();
      expect(organizationLookupCount).toBeGreaterThan(0);
    });

    organizationIndexVisible = true;
    await waitFor(
      () => {
        expect(
          within(contactsWindow).getByText(CONTACTS_LABELS.emptyState),
        ).toBeTruthy();
        expect(
          within(contactsWindow).queryByText(CONTACTS_LABELS.loadingState),
        ).toBeNull();
      },
      { timeout: PANE_ASYNC_TEST_TIMEOUT_MS },
    );
    expect(organizationLookupCount).toBeGreaterThan(1);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
